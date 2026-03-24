'use strict';

const nock = require('nock');
const FhirClient = require('../../src/fhir-client');

describe('FhirClient', () => {
  let client;

  beforeEach(() => {
    client = new FhirClient(5000);
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

    it('throws on 401 Unauthorized', async () => {
      nock('http://test-server:8080').get('/fhir/Patient').reply(401, 'Unauthorized');

      await expect(client.search(source, '/Patient', {})).rejects.toThrow();
    });

    it('throws on network error', async () => {
      nock('http://test-server:8080').get('/fhir/Patient').replyWithError('ECONNREFUSED');

      await expect(client.search(source, '/Patient', {})).rejects.toThrow('ECONNREFUSED');
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
  });
});
