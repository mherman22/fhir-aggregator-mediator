'use strict';

const express = require('express');
const supertest = require('supertest');
const createRouter = require('../../src/routes');
const PaginationManager = require('../../src/pagination');
const SourceMonitor = require('../../src/source-monitor');
const {
  testConfig,
  source1Bundle,
  source2Bundle,
  emptyBundle,
  paginatedBundle1,
  paginatedBundle2,
} = require('../fixtures/bundles');

describe('routes', () => {
  let app;
  let mockFhirClient;
  let paginationManager;
  let sourceMonitor;

  beforeEach(() => {
    mockFhirClient = {
      search: jest.fn(),
      fetchUrl: jest.fn(),
    };
    paginationManager = new PaginationManager(testConfig.pagination);
    sourceMonitor = new SourceMonitor();
    // Pre-populate source monitor status
    testConfig.sources.forEach((s) => {
      sourceMonitor.status[s.id] = {
        status: 'UP',
        name: s.name,
        lastError: null,
        lastChecked: new Date().toISOString(),
      };
    });

    const router = createRouter(testConfig, paginationManager, mockFhirClient, sourceMonitor);
    app = express();
    app.use(router);
  });

  describe('GET /fhir/metadata', () => {
    it('returns CapabilityStatement with correct FHIR version', async () => {
      const res = await supertest(app).get('/fhir/metadata').expect(200);
      expect(res.body.resourceType).toBe('CapabilityStatement');
      expect(res.body.fhirVersion).toBe('4.0.1');
    });

    it('lists supported resource types', async () => {
      const res = await supertest(app).get('/fhir/metadata').expect(200);
      const types = res.body.rest[0].resource.map((r) => r.type);
      expect(types).toContain('Patient');
      expect(types).toContain('Encounter');
      expect(types).toContain('Location');
    });

    it('includes source count in implementation description', async () => {
      const res = await supertest(app).get('/fhir/metadata').expect(200);
      expect(res.body.implementation.description).toContain('3');
    });

    it('returns application/fhir+json Content-Type', async () => {
      const res = await supertest(app).get('/fhir/metadata').expect(200);
      expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    });
  });

  describe('GET /fhir/:resourceType', () => {
    it('returns merged Bundle from all sources', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockResolvedValueOnce(source2Bundle)
        .mockResolvedValueOnce(emptyBundle);

      const res = await supertest(app).get('/fhir/Patient?_count=20').expect(200);
      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('searchset');
      expect(res.body.entry.length).toBeGreaterThan(0);
    });

    it('includes next link when sources have more pages', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(paginatedBundle1)
        .mockResolvedValueOnce(paginatedBundle2)
        .mockResolvedValueOnce(emptyBundle);

      const res = await supertest(app).get('/fhir/Location?_count=20').expect(200);
      const nextLink = res.body.link.find((l) => l.relation === 'next');
      expect(nextLink).toBeTruthy();
      expect(nextLink.url).toContain('_getpages=');
      expect(nextLink.url).toContain('_getpagesoffset=');
    });

    it('sets X-Aggregator-Sources-Failed header on partial failure', async () => {
      mockFhirClient.search
        .mockResolvedValueOnce(source1Bundle)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(emptyBundle);

      const res = await supertest(app).get('/fhir/Patient').expect(200);
      expect(res.headers['x-aggregator-sources-failed']).toBe('src2');
      expect(res.headers['x-aggregator-sources-failed-count']).toBe('1');
    });

    it('returns 500 on complete failure', async () => {
      mockFhirClient.search.mockImplementation(() => {
        throw new Error('catastrophic');
      });

      const res = await supertest(app).get('/fhir/Patient').expect(500);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('rejects invalid resource types', async () => {
      const res = await supertest(app).get('/fhir/InvalidType').expect(400);
      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('not-supported');
    });

    it('rejects path traversal attempts', async () => {
      const res = await supertest(app).get('/fhir/..%2Fadmin').expect(400);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('returns application/fhir+json Content-Type', async () => {
      mockFhirClient.search.mockResolvedValue(source1Bundle);
      const res = await supertest(app).get('/fhir/Patient').expect(200);
      expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    });

    it('caps _count at MAX_COUNT (500)', async () => {
      mockFhirClient.search.mockResolvedValue(emptyBundle);
      await supertest(app).get('/fhir/Patient?_count=9999').expect(200);
      // The _count param forwarded to sources should be capped at 500
      expect(mockFhirClient.search).toHaveBeenCalledWith(
        expect.anything(),
        '/Patient',
        expect.objectContaining({ _count: '500' })
      );
    });

    it('defaults negative _count to 20', async () => {
      mockFhirClient.search.mockResolvedValue(emptyBundle);
      await supertest(app).get('/fhir/Patient?_count=-5').expect(200);
      expect(mockFhirClient.search).toHaveBeenCalledWith(
        expect.anything(),
        '/Patient',
        expect.objectContaining({ _count: '20' })
      );
    });

    it('does not leak internal error details in diagnostics', async () => {
      mockFhirClient.search.mockImplementation(() => {
        throw new Error('ECONNREFUSED http://internal-server:8080/fhir');
      });
      const res = await supertest(app).get('/fhir/Patient').expect(500);
      expect(res.body.issue[0].diagnostics).toBe('Internal server error');
      expect(res.body.issue[0].diagnostics).not.toContain('ECONNREFUSED');
    });
  });

  describe('GET /fhir?_getpages=TOKEN', () => {
    it('returns 400 when _getpages is missing', async () => {
      const res = await supertest(app).get('/fhir').expect(400);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('returns 410 for expired token', async () => {
      const res = await supertest(app).get('/fhir?_getpages=nonexistent').expect(410);
      expect(res.body.issue[0].code).toBe('expired');
    });

    it('returns paginated results for valid token with offset', async () => {
      // Create a token
      const state = {
        src1: { token: 'abc', baseUrl: 'http://src1:8080/fhir' },
      };
      const token = paginationManager.createToken(state);
      mockFhirClient.fetchUrl.mockResolvedValue(source1Bundle);

      const res = await supertest(app)
        .get(`/fhir?_getpages=${token}&_getpagesoffset=20&_count=20`)
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.entry.length).toBeGreaterThan(0);
    });

    it('returns application/fhir+json Content-Type for pagination', async () => {
      const res = await supertest(app).get('/fhir?_getpages=nonexistent').expect(410);
      expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    });

    it('does not leak internal error details in pagination errors', async () => {
      const state = { src1: { token: 'abc', baseUrl: 'http://src1:8080/fhir' } };
      const token = paginationManager.createToken(state);
      mockFhirClient.fetchUrl.mockImplementation(() => {
        throw new Error('ECONNREFUSED http://internal:8080');
      });
      const res = await supertest(app)
        .get(`/fhir?_getpages=${token}&_getpagesoffset=0&_count=20`)
        .expect(500);
      expect(res.body.issue[0].diagnostics).toBe('Internal server error');
    });
  });
});
