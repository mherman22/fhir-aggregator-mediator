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
      expect(() => validateConfig(cfg)).toThrow('positive integer');
    });

    it('rejects non-integer performance.maxConcurrentUpstreamRequests (float)', () => {
      const cfg = { ...validConfig, performance: { maxConcurrentUpstreamRequests: 1.5 } };
      expect(() => validateConfig(cfg)).toThrow('positive integer');
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

    describe('source optional and bearerToken fields', () => {
      it('accepts source with optional: true', () => {
        const cfg = {
          ...validConfig,
          sources: [{ ...validConfig.sources[0], optional: true }],
        };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('rejects source with optional: "yes" (non-boolean)', () => {
        const cfg = {
          ...validConfig,
          sources: [{ ...validConfig.sources[0], optional: 'yes' }],
        };
        expect(() => validateConfig(cfg)).toThrow('optional must be a boolean');
      });

      it('accepts source with bearerToken', () => {
        const cfg = {
          ...validConfig,
          sources: [{ ...validConfig.sources[0], bearerToken: 'my-token' }],
        };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('rejects source with non-string bearerToken', () => {
        const cfg = {
          ...validConfig,
          sources: [{ ...validConfig.sources[0], bearerToken: 12345 }],
        };
        expect(() => validateConfig(cfg)).toThrow('bearerToken must be a string');
      });
    });

    describe('writeTarget', () => {
      it('accepts a valid writeTarget that references an existing source', () => {
        const cfg = { ...validConfig, writeTarget: 'src1' };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('rejects a writeTarget that does not reference an existing source', () => {
        const cfg = { ...validConfig, writeTarget: 'nonexistent' };
        expect(() => validateConfig(cfg)).toThrow('does not match any source id');
      });

      it('rejects a non-string writeTarget', () => {
        const cfg = { ...validConfig, writeTarget: 42 };
        expect(() => validateConfig(cfg)).toThrow('writeTarget must be a string');
      });
    });

    describe('inboundAuth', () => {
      it('accepts valid basic auth config', () => {
        const cfg = {
          ...validConfig,
          inboundAuth: { enabled: true, type: 'basic', username: 'u', password: 'p' },
        };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('accepts valid apikey auth config', () => {
        const cfg = {
          ...validConfig,
          inboundAuth: { enabled: true, type: 'apikey', apiKey: 'my-key' },
        };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('rejects invalid inboundAuth.type', () => {
        const cfg = {
          ...validConfig,
          inboundAuth: { enabled: true, type: 'oauth2' },
        };
        expect(() => validateConfig(cfg)).toThrow('inboundAuth.type must be');
      });

      it('rejects basic auth without username', () => {
        const cfg = {
          ...validConfig,
          inboundAuth: { enabled: true, type: 'basic', password: 'p' },
        };
        expect(() => validateConfig(cfg)).toThrow('inboundAuth.username is required');
      });

      it('rejects apikey auth without apiKey', () => {
        const cfg = {
          ...validConfig,
          inboundAuth: { enabled: true, type: 'apikey' },
        };
        expect(() => validateConfig(cfg)).toThrow('inboundAuth.apiKey is required');
      });
    });

    describe('tls', () => {
      it('accepts valid TLS config', () => {
        const cfg = {
          ...validConfig,
          tls: { enabled: true, certFile: '/path/cert.pem', keyFile: '/path/key.pem' },
        };
        expect(() => validateConfig(cfg)).not.toThrow();
      });

      it('rejects TLS enabled without certFile', () => {
        const cfg = { ...validConfig, tls: { enabled: true, keyFile: '/path/key.pem' } };
        expect(() => validateConfig(cfg)).toThrow('tls.certFile is required');
      });

      it('rejects TLS enabled without keyFile', () => {
        const cfg = { ...validConfig, tls: { enabled: true, certFile: '/path/cert.pem' } };
        expect(() => validateConfig(cfg)).toThrow('tls.keyFile is required');
      });

      it('accepts TLS config with enabled: false (no cert/key required)', () => {
        const cfg = { ...validConfig, tls: { enabled: false } };
        expect(() => validateConfig(cfg)).not.toThrow();
      });
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

    it('overrides source bearer token from env var', () => {
      process.env.SOURCE_src1_BEARER_TOKEN = 'my-jwt-token';
      const cfg = { app: { port: 3000 }, sources: [{ id: 'src1' }] };
      applyEnvOverrides(cfg);
      expect(cfg.sources[0].bearerToken).toBe('my-jwt-token');
    });

    it('sets inboundAuth from env vars', () => {
      process.env.INBOUND_AUTH_TYPE = 'basic';
      process.env.INBOUND_AUTH_USERNAME = 'u';
      process.env.INBOUND_AUTH_PASSWORD = 'p';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.inboundAuth.enabled).toBe(true);
      expect(cfg.inboundAuth.type).toBe('basic');
      expect(cfg.inboundAuth.username).toBe('u');
      expect(cfg.inboundAuth.password).toBe('p');
    });

    it('sets apikey inboundAuth from env vars', () => {
      process.env.INBOUND_AUTH_TYPE = 'apikey';
      process.env.INBOUND_AUTH_API_KEY = 'secret-key';
      process.env.INBOUND_AUTH_HEADER = 'X-My-Token';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.inboundAuth.type).toBe('apikey');
      expect(cfg.inboundAuth.apiKey).toBe('secret-key');
      expect(cfg.inboundAuth.header).toBe('X-My-Token');
    });

    it('sets TLS settings from env vars', () => {
      process.env.TLS_CERT_FILE = '/path/to/cert.pem';
      process.env.TLS_KEY_FILE = '/path/to/key.pem';
      process.env.TLS_PASSPHRASE = 'mypass';
      const cfg = { app: { port: 3000 }, sources: [] };
      applyEnvOverrides(cfg);
      expect(cfg.tls.enabled).toBe(true);
      expect(cfg.tls.certFile).toBe('/path/to/cert.pem');
      expect(cfg.tls.keyFile).toBe('/path/to/key.pem');
      expect(cfg.tls.passphrase).toBe('mypass');
    });

    it('sets writeTarget from env var', () => {
      process.env.WRITE_TARGET = 'src1';
      const cfg = { app: { port: 3000 }, sources: [{ id: 'src1' }] };
      applyEnvOverrides(cfg);
      expect(cfg.writeTarget).toBe('src1');
    });
  });
});
