'use strict';

const SourceMonitor = require('../../src/source-monitor');
const { testSources } = require('../fixtures/bundles');

describe('SourceMonitor', () => {
  let monitor;
  let mockFhirClient;

  beforeEach(() => {
    monitor = new SourceMonitor();
    mockFhirClient = { search: jest.fn() };
  });

  describe('validateAll', () => {
    it('sets all sources to UP when all succeed', async () => {
      mockFhirClient.search.mockResolvedValue({ resourceType: 'CapabilityStatement' });
      await monitor.validateAll(testSources, mockFhirClient);

      const health = monitor.getHealth();
      expect(health.status).toBe('UP');
      expect(health.sources).toHaveLength(3);
      health.sources.forEach((s) => expect(s.status).toBe('UP'));
    });

    it('throws when any required source fails authentication', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({ response: { status: 401 }, message: 'Unauthorized' })
        .mockResolvedValueOnce({});

      await expect(monitor.validateAll(testSources, mockFhirClient)).rejects.toThrow(
        'Source validation failed'
      );
    });

    it('throws when a required source is unreachable', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({});

      await expect(monitor.validateAll(testSources, mockFhirClient)).rejects.toThrow(
        'ECONNREFUSED'
      );
    });

    it('distinguishes AUTH_FAILED from DOWN', async () => {
      mockFhirClient.search
        .mockRejectedValueOnce({ response: { status: 401 }, message: 'Unauthorized' })
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({});

      try {
        await monitor.validateAll(testSources, mockFhirClient);
      } catch (e) {
        // expected
      }

      const health = monitor.getHealth();
      const src1 = health.sources.find((s) => s.id === 'src1');
      const src2 = health.sources.find((s) => s.id === 'src2');
      expect(src1.status).toBe('AUTH_FAILED');
      expect(src2.status).toBe('DOWN');
    });

    describe('optional sources', () => {
      const optionalSources = [
        {
          id: 'src1',
          name: 'Source 1',
          baseUrl: 'http://src1:8080/fhir',
          username: 'admin',
          password: 'pass',
        },
        {
          id: 'src2',
          name: 'Source 2',
          baseUrl: 'http://src2:8080/fhir',
          username: 'admin',
          password: 'pass',
          optional: true,
        },
        {
          id: 'src3',
          name: 'Source 3',
          baseUrl: 'http://src3:8080/fhir',
          username: 'admin',
          password: 'pass',
        },
      ];

      it('does not throw when an optional source fails validation', async () => {
        mockFhirClient.search
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValueOnce({});

        // Should NOT throw even though src2 (optional) is unreachable
        await expect(monitor.validateAll(optionalSources, mockFhirClient)).resolves.toBeUndefined();
      });

      it('marks optional failed source as DOWN', async () => {
        mockFhirClient.search
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValueOnce({});

        await monitor.validateAll(optionalSources, mockFhirClient);
        const health = monitor.getHealth();
        const src2 = health.sources.find((s) => s.id === 'src2');
        expect(src2.status).toBe('DOWN');
        expect(src2.optional).toBe(true);
      });

      it('overall health is UP when only optional sources are down', async () => {
        mockFhirClient.search
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValueOnce({});

        await monitor.validateAll(optionalSources, mockFhirClient);
        expect(monitor.getHealth().status).toBe('UP');
      });

      it('throws when a required source fails even if optional sources succeed', async () => {
        const mixedSources = [
          {
            id: 'req',
            name: 'Required',
            baseUrl: 'http://req:8080/fhir',
            username: 'a',
            password: 'b',
          },
          {
            id: 'opt',
            name: 'Optional',
            baseUrl: 'http://opt:8080/fhir',
            username: 'a',
            password: 'b',
            optional: true,
          },
        ];
        mockFhirClient.search
          .mockRejectedValueOnce(new Error('ECONNREFUSED')) // required fails
          .mockResolvedValueOnce({}); // optional succeeds

        await expect(monitor.validateAll(mixedSources, mockFhirClient)).rejects.toThrow(
          'ECONNREFUSED'
        );
      });
    });
  });

  describe('recordSuccess', () => {
    it('updates status to UP and clears error', async () => {
      mockFhirClient.search.mockResolvedValue({});
      await monitor.validateAll(testSources, mockFhirClient);

      // Simulate a failure then recovery
      monitor.recordFailure('src1', new Error('timeout'));
      expect(monitor.getHealth().sources.find((s) => s.id === 'src1').status).toBe('DOWN');

      monitor.recordSuccess('src1');
      const src1 = monitor.getHealth().sources.find((s) => s.id === 'src1');
      expect(src1.status).toBe('UP');
      expect(src1.lastError).toBeNull();
    });
  });

  describe('recordFailure', () => {
    it('sets AUTH_FAILED for 401 responses', async () => {
      mockFhirClient.search.mockResolvedValue({});
      await monitor.validateAll(testSources, mockFhirClient);

      monitor.recordFailure('src1', { response: { status: 401 }, message: 'Unauthorized' });
      expect(monitor.getHealth().sources.find((s) => s.id === 'src1').status).toBe('AUTH_FAILED');
    });

    it('sets DOWN for non-auth errors', async () => {
      mockFhirClient.search.mockResolvedValue({});
      await monitor.validateAll(testSources, mockFhirClient);

      monitor.recordFailure('src2', new Error('ETIMEDOUT'));
      const src2 = monitor.getHealth().sources.find((s) => s.id === 'src2');
      expect(src2.status).toBe('DOWN');
      expect(src2.lastError).toBe('ETIMEDOUT');
    });
  });

  describe('getHealth', () => {
    it('returns DEGRADED when any source is not UP', async () => {
      mockFhirClient.search.mockResolvedValue({});
      await monitor.validateAll(testSources, mockFhirClient);

      monitor.recordFailure('src2', new Error('down'));
      expect(monitor.getHealth().status).toBe('DEGRADED');
    });

    it('returns UP when all sources are UP', async () => {
      mockFhirClient.search.mockResolvedValue({});
      await monitor.validateAll(testSources, mockFhirClient);
      expect(monitor.getHealth().status).toBe('UP');
    });
  });
});
