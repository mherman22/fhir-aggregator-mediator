'use strict';

const { searchAll, fetchWithOffset } = require('../../src/aggregator');
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
    });

    it('merges all entries from all sources without dedup', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      // source1: 3 entries (p1, pr1, loc1), source2: 3 entries (p2, pr1, loc1), source3: 2 entries (p3, pr2)
      // pr1 and loc1 appear twice (cloned DB) — removed by duplicate ID filter
      // Unique: p1, pr1, loc1, p2, p3, pr2 = 6
      expect(result.entries).toHaveLength(6);
    });

    it('sums totals from all sources', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle) // total: 3
        .mockResolvedValueOnce(source2Bundle) // total: 3
        .mockResolvedValueOnce(emptyBundle); // total: 0

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.totalCount).toBe(6);
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

    it('handles malformed next-link URLs without crashing', async () => {
      const malformedBundle = makeBundle([{ resourceType: 'Location', id: 'loc1', name: 'X' }], 50);
      malformedBundle.link.push({ relation: 'next', url: ':::not-a-valid-url' });

      mockFhirClient.search
        .mockResolvedValueOnce(malformedBundle)
        .mockResolvedValueOnce(emptyBundle)
        .mockResolvedValueOnce(emptyBundle);

      const result = await searchAll('/Location', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.entries).toHaveLength(1);
      expect(result.sourceTokens.src1).toBeUndefined();
    });

    it('returns hasMore=false when no sources have next pages', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(source3Bundle);

      const result = await searchAll('/Patient', {}, testSources, mockFhirClient, mockMonitor);
      expect(result.hasMore).toBe(false);
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

    it('removes duplicate resource IDs across sources', async () => {
      mockFhirClient.fetchUrl
        .mockResolvedValueOnce(source1Bundle) // has pr1
        .mockResolvedValueOnce(source2Bundle); // also has pr1

      const result = await fetchWithOffset(state, 0, 20, testSources, mockFhirClient, mockMonitor);
      // pr1 appears in both sources (cloned DB) — only one copy kept
      const prIds = result.entries
        .filter((e) => e.resource.resourceType === 'Practitioner')
        .map((e) => e.resource.id);
      expect(prIds).toEqual(['pr1']);
    });
  });
});
