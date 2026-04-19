'use strict';

const { validateConfig, applyEnvOverrides } = require('../../src/config-validator');

describe('config-validator', () => {
  describe('validateConfig', () => {
    const validConfig = {
      app: { port: 3000 },
      sources: [
        {
          id: 'src1',
          name: 'Source 1',
          baseUrl: 'http://localhost:8080/fhir',
          username: 'admin',
          password: 'pass',
        },
      ],
    };

    it('accepts a valid configuration', () => {
      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it('rejects missing app.port', () => {
      expect(() => validateConfig({ ...validConfig, app: {} })).toThrow(
        'app.port must be a number'
      );
    });

    it('rejects port out of range', () => {
      expect(() => validateConfig({ ...validConfig, app: { port: 99999 } })).toThrow(
        'app.port must be a number'
      );
    });

    it('rejects empty sources array', () => {
      expect(() => validateConfig({ ...validConfig, sources: [] })).toThrow('non-empty array');
    });

    it('rejects missing source id', () => {
      const cfg = { ...validConfig, sources: [{ name: 'X', baseUrl: 'http://x' }] };
      expect(() => validateConfig(cfg)).toThrow('id is required');
    });

    it('rejects duplicate source ids', () => {
      const cfg = {
        ...validConfig,
        sources: [
          { id: 'src1', name: 'A', baseUrl: 'http://a' },
          { id: 'src1', name: 'B', baseUrl: 'http://b' },
        ],
      };
      expect(() => validateConfig(cfg)).toThrow('duplicated');
    });

    it('rejects invalid source URL', () => {
      const cfg = { ...validConfig, sources: [{ id: 'src1', name: 'A', baseUrl: 'not-a-url' }] };
      expect(() => validateConfig(cfg)).toThrow('not a valid URL');
    });

    it('rejects invalid performance.timeoutMs', () => {
      const cfg = { ...validConfig, performance: { timeoutMs: -1 } };
      expect(() => validateConfig(cfg)).toThrow('positive number');
    });

    it('rejects invalid performance.maxConcurrentUpstreamRequests', () => {
      const cfg = { ...validConfig, performance: { maxConcurrentUpstreamRequests: 0 } };
      expect(() => validateConfig(cfg)).toThrow('positive number');
    });

    it('rejects invalid performance.requestTimeoutMs', () => {
      const cfg = { ...validConfig, performance: { requestTimeoutMs: -100 } };
      expect(() => validateConfig(cfg)).toThrow('positive number');
    });

    it('rejects invalid pagination.cacheMaxSize', () => {
      const cfg = { ...validConfig, pagination: { cacheMaxSize: 0 } };
      expect(() => validateConfig(cfg)).toThrow('positive number');
    });

    it('rejects non-boolean strictMode', () => {
      const cfg = { ...validConfig, strictMode: 'yes' };
      expect(() => validateConfig(cfg)).toThrow('strictMode must be a boolean');
    });

    it('accepts strictMode: true', () => {
      const cfg = { ...validConfig, strictMode: true };
      expect(() => validateConfig(cfg)).not.toThrow();
    });

    it('accepts strictMode: false', () => {
      const cfg = { ...validConfig, strictMode: false };
      expect(() => validateConfig(cfg)).not.toThrow();
    });

    it('accepts valid optional settings', () => {
      const cfg = {
        ...validConfig,
        performance: {
          timeoutMs: 5000,
          maxSocketsPerSource: 10,
          maxConcurrentUpstreamRequests: 50,
          requestTimeoutMs: 120000,
        },
        pagination: { cacheMaxSize: 500, cacheTtlMs: 60000 },
        strictMode: false,
      };
      expect(() => validateConfig(cfg)).not.toThrow();
    });
  });

  describe('applyEnvOverrides', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('overrides app port from APP_PORT', () => {
      process.env.APP_PORT = '4000';
      const cfg = { app: { port: 3000 }, sources: [{ id: 'src1' }] };
      applyEnvOverrides(cfg);
      expect(cfg.app.port).toBe(4000);
    });

    it('overrides source credentials from env vars', () => {
      process.env.SOURCE_src1_USERNAME = 'newuser';
      process.env.SOURCE_src1_PASSWORD = 'newpass';
      const cfg = {
        app: { port: 3000 },
        sources: [{ id: 'src1', username: 'old', password: 'old' }],
      };
      applyEnvOverrides(cfg);
      expect(cfg.sources[0].username).toBe('newuser');
      expect(cfg.sources[0].password).toBe('newpass');
    });

    it('overrides source URL from env var', () => {
      process.env.SOURCE_src1_URL = 'http://new-url:8080/fhir';
      const cfg = { app: { port: 3000 }, sources: [{ id: 'src1', baseUrl: 'http://old' }] };
      applyEnvOverrides(cfg);
      expect(cfg.sources[0].baseUrl).toBe('http://new-url:8080/fhir');
    });

    it('overrides full sources from SOURCES JSON env var', () => {
      process.env.SOURCES = JSON.stringify([{ id: 'new', name: 'New', baseUrl: 'http://new' }]);
      const cfg = { app: { port: 3000 }, sources: [{ id: 'old' }] };
      applyEnvOverrides(cfg);
      expect(cfg.sources).toHaveLength(1);
      expect(cfg.sources[0].id).toBe('new');
    });

    it('throws on invalid SOURCES JSON', () => {
      process.env.SOURCES = 'not-json';
      const cfg = { app: { port: 3000 }, sources: [] };
      expect(() => applyEnvOverrides(cfg)).toThrow('Failed to parse SOURCES');
    });

    it('overrides performance settings from env vars', () => {
      process.env.PERFORMANCE_TIMEOUT_MS = '10000';
      process.env.PERFORMANCE_MAX_SOCKETS_PER_SOURCE = '20';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.performance.timeoutMs).toBe(10000);
      expect(cfg.performance.maxSocketsPerSource).toBe(20);
    });

    it('overrides maxConcurrentUpstreamRequests from env var', () => {
      process.env.PERFORMANCE_MAX_CONCURRENT_UPSTREAM_REQUESTS = '25';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.performance.maxConcurrentUpstreamRequests).toBe(25);
    });

    it('sets strictMode from STRICT_MODE env var', () => {
      process.env.STRICT_MODE = 'true';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.strictMode).toBe(true);
    });

    it('disables strictMode from STRICT_MODE=false env var', () => {
      process.env.STRICT_MODE = 'false';
      const cfg = { app: { port: 3000 }, sources: [], strictMode: true };
      applyEnvOverrides(cfg);
      expect(cfg.strictMode).toBe(false);
    });

    it('overrides pagination settings from env vars', () => {
      process.env.PAGINATION_CACHE_MAX_SIZE = '2000';
      process.env.PAGINATION_CACHE_TTL_MS = '7200000';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.pagination.cacheMaxSize).toBe(2000);
      expect(cfg.pagination.cacheTtlMs).toBe(7200000);
    });

    it('overrides OpenHIM credentials from env vars', () => {
      process.env.OPENHIM_API_USERNAME = 'admin@openhim.org';
      process.env.OPENHIM_API_PASSWORD = 'secret';
      process.env.OPENHIM_API_URL = 'https://new-openhim:8080';
      const cfg = {
        app: { port: 3000 },
        sources: [],
        mediator: { api: { username: 'old', password: 'old', apiURL: 'http://old' } },
      };
      applyEnvOverrides(cfg);
      expect(cfg.mediator.api.username).toBe('admin@openhim.org');
      expect(cfg.mediator.api.password).toBe('secret');
      expect(cfg.mediator.api.apiURL).toBe('https://new-openhim:8080');
    });
  });
});
