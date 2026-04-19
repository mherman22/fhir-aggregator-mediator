'use strict';

const nock = require('nock');
const FhirClient = require('../../src/fhir-client');

describe('FhirClient', () => {
  let client;

  beforeEach(() => {
    client = new FhirClient({ timeout: 5000, maxSocketsPerSource: 2, maxRetries: 0 });
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  const source = {
    id: 'test',
    name: 'Test',
    baseUrl: 'http://test-server:8080/fhir',
    username: 'admin',
    password: 'secret',
  };

  const noAuthSource = {
    id: 'noauth',
    name: 'No Auth',
    baseUrl: 'http://test-server:8080/fhir',
    username: '',
    password: '',
  };

  const bearerSource = {
    id: 'bearer',
    name: 'Bearer Auth',
    baseUrl: 'http://test-server:8080/fhir',
    bearerToken: 'my-jwt-token',
  };

  describe('search', () => {
    it('sends GET with correct URL, auth, and params', async () => {
      const scope = nock('http://test-server:8080')
        .get('/fhir/Patient')
        .query({ _count: '20' })
        .basicAuth({ user: 'admin', pass: 'secret' })
        .reply(200, { resourceType: 'Bundle', entry: [] });

      const result = await client.search(source, '/Patient', { _count: '20' });
      expect(result.resourceType).toBe('Bundle');
      scope.done();
    });

    it('sends Accept: application/fhir+json header', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { Accept: 'application/fhir+json' },
      })
        .get('/fhir/Patient')
        .reply(200, { resourceType: 'Bundle' });

      await client.search(source, '/Patient', {});
      scope.done();
    });

    it('propagates extra headers (e.g. X-Correlation-ID) to upstream', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { 'X-Correlation-ID': 'test-corr-id' },
      })
        .get('/fhir/Patient')
        .reply(200, { resourceType: 'Bundle' });

      await client.search(source, '/Patient', {}, { 'X-Correlation-ID': 'test-corr-id' });
      scope.done();
    });

    it('throws on 401 Unauthorized', async () => {
      nock('http://test-server:8080').get('/fhir/Patient').reply(401, 'Unauthorized');

      await expect(client.search(source, '/Patient', {})).rejects.toThrow();
    });

    it('throws on network error', async () => {
      nock('http://test-server:8080').get('/fhir/Patient').replyWithError('ECONNREFUSED');

      await expect(client.search(source, '/Patient', {})).rejects.toThrow('ECONNREFUSED');
    });

    it('does not send auth header when username is empty', async () => {
      const scope = nock('http://test-server:8080')
        .get('/fhir/Patient')
        .reply(200, function () {
          // Verify no Authorization header was sent
          expect(this.req.headers.authorization).toBeUndefined();
          return { resourceType: 'Bundle', entry: [] };
        });

      await client.search(noAuthSource, '/Patient', {});
      scope.done();
    });
  });

  describe('fetchUrl', () => {
    it('sends GET to absolute URL with auth', async () => {
      const absUrl = 'http://test-server:8080/fhir?_getpages=abc&_getpagesoffset=20';
      const scope = nock('http://test-server:8080')
        .get('/fhir')
        .query({ _getpages: 'abc', _getpagesoffset: '20' })
        .basicAuth({ user: 'admin', pass: 'secret' })
        .reply(200, { resourceType: 'Bundle', entry: [] });

      const result = await client.fetchUrl(source, absUrl);
      expect(result.resourceType).toBe('Bundle');
      scope.done();
    });

    it('throws on 500 server error', async () => {
      nock('http://test-server:8080').get('/fhir').reply(500, 'Internal Server Error');

      await expect(client.fetchUrl(source, 'http://test-server:8080/fhir')).rejects.toThrow();
    });

    it('does not send auth header when username is empty', async () => {
      const scope = nock('http://test-server:8080')
        .get('/fhir')
        .reply(200, function () {
          expect(this.req.headers.authorization).toBeUndefined();
          return { resourceType: 'Bundle', entry: [] };
        });

      await client.fetchUrl(noAuthSource, 'http://test-server:8080/fhir');
      scope.done();
    });
  });

  describe('constructor', () => {
    it('enables TLS verification by default', () => {
      const c = new FhirClient({});
      expect(c.httpsAgent.options.rejectUnauthorized).toBe(true);
      c.destroy();
    });

    it('disables TLS verification when rejectUnauthorized is false', () => {
      const c = new FhirClient({ rejectUnauthorized: false });
      expect(c.httpsAgent.options.rejectUnauthorized).toBe(false);
      c.destroy();
    });

    it('sets default maxContentLength and maxRedirects', () => {
      const c = new FhirClient({});
      expect(c.maxContentLength).toBe(50 * 1024 * 1024);
      expect(c.maxRedirects).toBe(5);
      c.destroy();
    });

    it('allows custom maxContentLength and maxRedirects', () => {
      const c = new FhirClient({ maxContentLength: 10 * 1024 * 1024, maxRedirects: 0 });
      expect(c.maxContentLength).toBe(10 * 1024 * 1024);
      expect(c.maxRedirects).toBe(0);
      c.destroy();
    });

    it('sets default retry configuration', () => {
      const c = new FhirClient({});
      expect(c.maxRetries).toBe(3);
      expect(c.initialDelayMs).toBe(500);
      expect(c.maxDelayMs).toBe(5000);
      c.destroy();
    });

    it('allows custom retry configuration', () => {
      const c = new FhirClient({ maxRetries: 5, initialDelayMs: 100, maxDelayMs: 2000 });
      expect(c.maxRetries).toBe(5);
      expect(c.initialDelayMs).toBe(100);
      expect(c.maxDelayMs).toBe(2000);
      c.destroy();
    });

    it('reads timeout from timeoutMs (config.json key)', () => {
      const c = new FhirClient({ timeoutMs: 12345 });
      expect(c.timeout).toBe(12345);
      c.destroy();
    });

    it('falls back to legacy timeout key when timeoutMs absent', () => {
      const c = new FhirClient({ timeout: 9999 });
      expect(c.timeout).toBe(9999);
      c.destroy();
    });

    it('prefers timeoutMs over legacy timeout when both present', () => {
      const c = new FhirClient({ timeoutMs: 8000, timeout: 4000 });
      expect(c.timeout).toBe(8000);
      c.destroy();
    });
  });

  describe('retry behavior', () => {
    it('retries on 503 and succeeds on subsequent attempt', async () => {
      const retryClient = new FhirClient({
        timeout: 5000,
        maxSocketsPerSource: 2,
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      });
      const scope = nock('http://test-server:8080')
        .get('/fhir/Patient')
        .reply(503, 'Service Unavailable')
        .get('/fhir/Patient')
        .reply(200, { resourceType: 'Bundle', entry: [] });

      const result = await retryClient.search(source, '/Patient', {});
      expect(result.resourceType).toBe('Bundle');
      scope.done();
      retryClient.destroy();
    });

    it('does not retry on 401 Unauthorized', async () => {
      const retryClient = new FhirClient({
        timeout: 5000,
        maxSocketsPerSource: 2,
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      });
      nock('http://test-server:8080').get('/fhir/Patient').reply(401, 'Unauthorized');

      await expect(retryClient.search(source, '/Patient', {})).rejects.toThrow();
      retryClient.destroy();
    });

    it('does not retry on 404 Not Found', async () => {
      const retryClient = new FhirClient({
        timeout: 5000,
        maxSocketsPerSource: 2,
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      });
      nock('http://test-server:8080').get('/fhir/Patient').reply(404, 'Not Found');

      await expect(retryClient.search(source, '/Patient', {})).rejects.toThrow();
      retryClient.destroy();
    });
  });

  describe('bearer token auth', () => {
    it('sends Authorization: Bearer header for sources with bearerToken', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { Authorization: 'Bearer my-jwt-token' },
      })
        .get('/fhir/Patient')
        .reply(200, { resourceType: 'Bundle', entry: [] });

      await client.search(bearerSource, '/Patient', {});
      scope.done();
    });

    it('does NOT send Basic Auth when bearerToken is present', async () => {
      const scope = nock('http://test-server:8080')
        .get('/fhir/Patient')
        .reply(200, function () {
          // Basic Auth header should not be present
          expect(this.req.headers.authorization).toMatch(/^Bearer /);
          return { resourceType: 'Bundle', entry: [] };
        });

      const sourceWithBothCreds = {
        id: 'both',
        baseUrl: 'http://test-server:8080/fhir',
        username: 'admin',
        password: 'pass',
        bearerToken: 'my-jwt-token',
      };
      await client.search(sourceWithBothCreds, '/Patient', {});
      scope.done();
    });

    it('fetchUrl sends Bearer token for sources with bearerToken', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { Authorization: 'Bearer my-jwt-token' },
      })
        .get('/fhir')
        .reply(200, { resourceType: 'Bundle', entry: [] });

      await client.fetchUrl(bearerSource, 'http://test-server:8080/fhir');
      scope.done();
    });
  });

  describe('write (POST/PUT/PATCH/DELETE)', () => {
    it('sends POST request with body and basic auth', async () => {
      const body = { resourceType: 'Patient', id: 'p1' };
      const scope = nock('http://test-server:8080')
        .post('/fhir/Patient', body)
        .basicAuth({ user: 'admin', pass: 'secret' })
        .reply(201, { resourceType: 'Patient', id: 'p1' });

      const result = await client.write(source, 'POST', '/Patient', body);
      expect(result.status).toBe(201);
      expect(result.data.resourceType).toBe('Patient');
      scope.done();
    });

    it('sends PUT request with body', async () => {
      const body = { resourceType: 'Patient', id: 'p1' };
      const scope = nock('http://test-server:8080').put('/fhir/Patient/p1', body).reply(200, body);

      const result = await client.write(source, 'PUT', '/Patient/p1', body);
      expect(result.status).toBe(200);
      scope.done();
    });

    it('sends DELETE request without body', async () => {
      const scope = nock('http://test-server:8080').delete('/fhir/Patient/p1').reply(204);

      const result = await client.write(source, 'DELETE', '/Patient/p1', undefined);
      expect(result.status).toBe(204);
      scope.done();
    });

    it('sends Bearer token on write when bearerToken is present', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { Authorization: 'Bearer my-jwt-token' },
      })
        .post('/fhir/Patient')
        .reply(201, { resourceType: 'Patient', id: 'p2' });

      const result = await client.write(bearerSource, 'POST', '/Patient', {});
      expect(result.status).toBe(201);
      scope.done();
    });

    it('propagates extra headers on write', async () => {
      const scope = nock('http://test-server:8080', {
        reqheaders: { 'X-Correlation-ID': 'test-id' },
      })
        .post('/fhir/Patient')
        .reply(201, {});

      await client.write(source, 'POST', '/Patient', {}, { 'X-Correlation-ID': 'test-id' });
      scope.done();
    });

    it('throws on upstream 4xx error', async () => {
      nock('http://test-server:8080')
        .put('/fhir/Patient/x')
        .reply(422, { resourceType: 'OperationOutcome', issue: [] });

      await expect(client.write(source, 'PUT', '/Patient/x', {})).rejects.toThrow();
    });
  });
});
