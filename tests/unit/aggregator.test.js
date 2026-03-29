'use strict';

const { searchAll, fetchWithOffset, getDeduplicationKey } = require('../../src/aggregator');
const {
  makeBundle,
  source1Bundle,
  source2Bundle,
  source3Bundle,
  emptyBundle,
  paginatedBundle1,
  paginatedBundle2,
  testSources,
} = require('../fixtures/bundles');

describe('aggregator', () => {
  let mockFhirClient;
  let mockMonitor;

  beforeEach(() => {
    mockFhirClient = {
      search: jest.fn(),
      fetchUrl: jest.fn(),
    };
    mockMonitor = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
  });

  describe('searchAll', () => {
    it('fans out to all sources in parallel', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      await searchAll('/Patient', { _count: '20' }, testSources, mockFhirClient, mockMonitor);
      expect(mockFhirClient.search).toHaveBeenCalledTimes(3);
      expect(mockFhirClient.search).toHaveBeenCalledWith(testSources[0], '/Patient', {
        _count: '20',
      });
      expect(mockFhirClient.search).toHaveBeenCalledWith(testSources[1], '/Patient', {
        _count: '20',
      });
      expect(mockFhirClient.search).toHaveBeenCalledWith(testSources[2], '/Patient', {
        _count: '20',
      });
    });

    it('merges entries from all sources', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      // 3 patients + 2 practitioners + 2 locations = 7, but pr1 and loc1 are duped
      // After dedup: p1, p2, p3, pr1, loc1, pr2 = 6
      expect(result.entries).toHaveLength(6);
    });

    it('deduplicates resources with same resourceType/id', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle) // has pr1, loc1
        .mockResolvedValueOnce(source2Bundle) // also has pr1, loc1
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      const prIds = result.entries
        .filter((e) => e.resource.resourceType === 'Practitioner')
        .map((e) => e.resource.id);
      expect(prIds).toEqual(['pr1']); // only one copy
    });

    it('handles partial source failures gracefully', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(source3Bundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.failedSources).toEqual(['src2']);
      expect(mockMonitor.recordFailure).toHaveBeenCalledWith('src2', expect.any(Error));
    });

    it('records success for working sources', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(mockMonitor.recordSuccess).toHaveBeenCalledWith('src1');
      expect(mockMonitor.recordSuccess).toHaveBeenCalledWith('src2');
      expect(mockMonitor.recordSuccess).toHaveBeenCalledWith('src3');
    });

    it('returns all failed when every source is down', async () => {
      mockFhirClient.search
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'));

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.entries).toHaveLength(0);
      expect(result.failedSources).toEqual(['src1', 'src2', 'src3']);
    });

    it('extracts _getpages tokens from next links', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(paginatedBundle1)
        .mockResolvedValueOnce(paginatedBundle2)
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Location', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.hasMore).toBe(true);
      expect(result.sourceTokens.src1.token).toBe('abc123');
      expect(result.sourceTokens.src2.token).toBe('def456');
      expect(result.sourceTokens.src3).toBeUndefined();
    });

    it('returns hasMore=false when no sources have next pages', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.hasMore).toBe(false);
    });

    it('uses deduped count as total when all fit in one page', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle) // total: 3
        .mockResolvedValueOnce(source2Bundle) // total: 3 (2 dupes)
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      // Raw total = 6, but deduped entries = 4 (p1, p2, pr1, loc1)
      expect(result.totalCount).toBe(result.entries.length);
    });

    it('applies dedup ratio to estimate total when paginated', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(paginatedBundle1) // total: 100, 2 entries (loc1, loc2), has next
        .mockResolvedValueOnce(paginatedBundle2) // total: 100, 1 entry  (loc1 — dup), has next
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Location', {}, testSources, mockFhirClient, mockMonitor);
      // Raw total = 200, raw entries = 3, deduped entries = 2
      // Dedup ratio = 2/3, adjusted total = ceil(200 * 2/3) = 134
      expect(result.totalCount).toBe(134);
    });

    it('falls back to deduped count when paginated but no entries returned', async () => {
      // Edge case: sources report totals and next links but return zero entries
      const emptyWithNext = makeBundle(
        [],
        50,
        'http://src:8080/fhir?_getpages=tok1&_getpagesoffset=20&_count=20'
      );
      mockFhirClient.search
        .mockResolvedValueOnce(emptyWithNext)
        .mockResolvedValueOnce(emptyBundle)
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Location', {}, testSources, mockFhirClient, mockMonitor);
      // No entries to compute a dedup ratio — total should fall back to 0
      expect(result.totalCount).toBe(0);
    });

    it('works without sourceMonitor', async () => {
      mockFhirClient.search.mockResolvedValue(source1Bundle);
      const result = await searchAll('/Patient', {}, [testSources[0]], mockFhirClient, null);
      expect(result.entries.length).toBeGreaterThan(0);
    });
  });

  describe('fetchWithOffset', () => {
    const state = {
      src1: { token: 'abc123', baseUrl: 'http://src1:8080/fhir' },
      src2: { token: 'def456', baseUrl: 'http://src2:8080/fhir' },
    };

    it('fetches from sources in state with correct offset URL', async () => {
      mockFhirClient.fetchUrl.mockResolvedValue(source1Bundle);

      await fetchWithOffset(state, 40, 20, testSources, mockFhirClient, mockMonitor);

      expect(mockFhirClient.fetchUrl).toHaveBeenCalledTimes(2);
      expect(mockFhirClient.fetchUrl).toHaveBeenCalledWith(
        testSources[0],
        'http://src1:8080/fhir?_getpages=abc123&_getpagesoffset=40&_count=20'
      );
      expect(mockFhirClient.fetchUrl).toHaveBeenCalledWith(
        testSources[1],
        'http://src2:8080/fhir?_getpages=def456&_getpagesoffset=40&_count=20'
      );
    });

    it('skips sources not in state', async () => {
      mockFhirClient.fetchUrl.mockResolvedValue(source1Bundle);
      const partialState = { src1: { token: 'abc', baseUrl: 'http://src1:8080/fhir' } };

      await fetchWithOffset(partialState, 0, 20, testSources, mockFhirClient, mockMonitor);
      expect(mockFhirClient.fetchUrl).toHaveBeenCalledTimes(1);
    });

    it('handles partial failures and reports them', async () => {
      mockFhirClient.fetchUrl
        .mockResolvedValueOnce(source1Bundle)
        .mockRejectedValueOnce(new Error('timeout'));

      const result = await fetchWithOffset(state, 0, 20, testSources, mockFhirClient, mockMonitor);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.failedSources).toEqual(['src2']);
    });

    it('deduplicates results', async () => {
      mockFhirClient.fetchUrl
        .mockResolvedValueOnce(source1Bundle) // has pr1
        .mockResolvedValueOnce(source2Bundle); // also has pr1

      const result = await fetchWithOffset(state, 0, 20, testSources, mockFhirClient, mockMonitor);
      const prIds = result.entries
        .filter((e) => e.resource.resourceType === 'Practitioner')
        .map((e) => e.resource.id);
      expect(prIds).toEqual(['pr1']);
    });
  });

  describe('getDeduplicationKey', () => {
    it('returns resourceType/id when no config is provided', () => {
      const entry = { resource: { resourceType: 'Patient', id: 'p1' } };
      expect(getDeduplicationKey(entry)).toBe('Patient/p1');
    });

    it('returns resourceType/id when config has no deduplication section', () => {
      const entry = { resource: { resourceType: 'Patient', id: 'p1' } };
      expect(getDeduplicationKey(entry, { sources: [] })).toBe('Patient/p1');
    });

    it('uses default strategy when resourceType has no specific config', () => {
      const entry = { resource: { resourceType: 'Location', id: 'loc1' } };
      const config = { deduplication: { default: { strategy: 'resourceId' } } };
      expect(getDeduplicationKey(entry, config)).toBe('Location/loc1');
    });

    it('keys on business identifier when strategy is identifier', () => {
      const entry = {
        resource: {
          resourceType: 'Patient',
          id: 'p1',
          identifier: [
            { system: 'http://hospital-a.org/mrn', value: 'MRN-111' },
            { system: 'http://national-cr.org/master-id', value: 'MASTER-001' },
          ],
        },
      };
      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://national-cr.org/master-id' },
          default: { strategy: 'resourceId' },
        },
      };
      expect(getDeduplicationKey(entry, config)).toBe('Patient/MASTER-001');
    });

    it('falls back to resourceType/id when identifier system not found', () => {
      const entry = {
        resource: {
          resourceType: 'Patient',
          id: 'p1',
          identifier: [{ system: 'http://hospital-a.org/mrn', value: 'MRN-111' }],
        },
      };
      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://national-cr.org/master-id' },
        },
      };
      expect(getDeduplicationKey(entry, config)).toBe('Patient/p1');
    });

    it('falls back to resourceType/id when resource has no identifiers', () => {
      const entry = { resource: { resourceType: 'Patient', id: 'p1' } };
      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://national-cr.org/master-id' },
        },
      };
      expect(getDeduplicationKey(entry, config)).toBe('Patient/p1');
    });

    it('uses resourceType-specific config over default', () => {
      const entry = {
        resource: {
          resourceType: 'Patient',
          id: 'p1',
          identifier: [{ system: 'http://cr.org/id', value: 'CR-99' }],
        },
      };
      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://cr.org/id' },
          default: { strategy: 'resourceId' },
        },
      };
      expect(getDeduplicationKey(entry, config)).toBe('Patient/CR-99');
    });
  });

  describe('identifier-based deduplication in searchAll', () => {
    it('deduplicates cross-facility patients by business identifier', async () => {
      const hospitalABundle = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'abc',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-1' }],
            name: [{ family: 'Smith' }],
          },
        ],
        1
      );
      const hospitalBBundle = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'xyz',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-1' }],
            name: [{ family: 'Smith' }],
          },
        ],
        1
      );

      mockFhirClient.search
        .mockResolvedValueOnce(hospitalABundle)
        .mockResolvedValueOnce(hospitalBBundle)
        .mockResolvedValueOnce(emptyBundle);

      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://cr.org/master' },
          default: { strategy: 'resourceId' },
        },
      };

      const result = await searchAll(
        '/Patient',
        {},
        testSources,
        mockFhirClient,
        mockMonitor,
        config
      );
      // Two different IDs (abc, xyz) but same master identifier MASTER-1 → deduplicated to 1
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].resource.id).toBe('abc');
    });

    it('keeps cross-facility patients with different business identifiers', async () => {
      const hospitalABundle = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'abc',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-1' }],
          },
        ],
        1
      );
      const hospitalBBundle = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'xyz',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-2' }],
          },
        ],
        1
      );

      mockFhirClient.search
        .mockResolvedValueOnce(hospitalABundle)
        .mockResolvedValueOnce(hospitalBBundle)
        .mockResolvedValueOnce(emptyBundle);

      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://cr.org/master' },
        },
      };

      const result = await searchAll(
        '/Patient',
        {},
        testSources,
        mockFhirClient,
        mockMonitor,
        config
      );
      expect(result.entries).toHaveLength(2);
    });

    it('applies identifier dedup only to configured resourceTypes', async () => {
      // Patient uses identifier strategy; Practitioner uses default (resourceId)
      const bundleA = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'abc',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-1' }],
          },
          { resourceType: 'Practitioner', id: 'pr1', name: [{ family: 'Dr. A' }] },
        ],
        2
      );
      const bundleB = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'xyz',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-1' }],
          },
          { resourceType: 'Practitioner', id: 'pr1', name: [{ family: 'Dr. A' }] },
        ],
        2
      );

      mockFhirClient.search
        .mockResolvedValueOnce(bundleA)
        .mockResolvedValueOnce(bundleB)
        .mockResolvedValueOnce(emptyBundle);

      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://cr.org/master' },
          default: { strategy: 'resourceId' },
        },
      };

      const result = await searchAll(
        '/Patient',
        {},
        testSources,
        mockFhirClient,
        mockMonitor,
        config
      );
      // Patient MASTER-1 deduped (2 → 1), Practitioner pr1 deduped by resourceId (2 → 1)
      expect(result.entries).toHaveLength(2);
      const patientEntries = result.entries.filter((e) => e.resource.resourceType === 'Patient');
      const practitionerEntries = result.entries.filter(
        (e) => e.resource.resourceType === 'Practitioner'
      );
      expect(patientEntries).toHaveLength(1);
      expect(practitionerEntries).toHaveLength(1);
    });
  });

  describe('identifier-based deduplication in fetchWithOffset', () => {
    const state = {
      src1: { token: 'abc123', baseUrl: 'http://src1:8080/fhir' },
      src2: { token: 'def456', baseUrl: 'http://src2:8080/fhir' },
    };

    it('deduplicates cross-facility patients by business identifier', async () => {
      const bundleA = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'p-hosp-a',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-42' }],
          },
        ],
        1
      );
      const bundleB = makeBundle(
        [
          {
            resourceType: 'Patient',
            id: 'p-hosp-b',
            identifier: [{ system: 'http://cr.org/master', value: 'MASTER-42' }],
          },
        ],
        1
      );

      mockFhirClient.fetchUrl.mockResolvedValueOnce(bundleA).mockResolvedValueOnce(bundleB);

      const config = {
        deduplication: {
          Patient: { strategy: 'identifier', system: 'http://cr.org/master' },
        },
      };

      const result = await fetchWithOffset(
        state,
        0,
        20,
        testSources,
        mockFhirClient,
        mockMonitor,
        config
      );
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].resource.id).toBe('p-hosp-a');
    });
  });
});
