'use strict';

const express = require('express');
const supertest = require('supertest');
const { createAuthMiddleware } = require('../../src/auth-middleware');

function makeApp(authConfig) {
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware(authConfig));
  app.get('/fhir/Patient', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.json({ status: 'UP' }));
  app.get('/ready', (req, res) => res.json({ status: 'READY' }));
  app.get('/metrics', (req, res) => res.send('# metrics'));
  return app;
}

describe('createAuthMiddleware', () => {
  describe('basic auth mode', () => {
    const authConfig = { type: 'basic', username: 'admin', password: 's3cr3t' };
    let app;

    beforeEach(() => {
      app = makeApp(authConfig);
    });

    it('allows a request with correct Basic Auth credentials', async () => {
      const res = await supertest(app).get('/fhir/Patient').auth('admin', 's3cr3t').expect(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects a request with incorrect password', async () => {
      const res = await supertest(app).get('/fhir/Patient').auth('admin', 'wrongpass').expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('rejects a request with incorrect username', async () => {
      const res = await supertest(app).get('/fhir/Patient').auth('wronguser', 's3cr3t').expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('rejects a request with no Authorization header', async () => {
      const res = await supertest(app).get('/fhir/Patient').expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('sets WWW-Authenticate header on 401', async () => {
      const res = await supertest(app).get('/fhir/Patient').expect(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
    });

    it('exempts /health from auth', async () => {
      const res = await supertest(app).get('/health').expect(200);
      expect(res.body.status).toBe('UP');
    });

    it('exempts /ready from auth', async () => {
      const res = await supertest(app).get('/ready').expect(200);
      expect(res.body.status).toBe('READY');
    });

    it('exempts /metrics from auth', async () => {
      await supertest(app).get('/metrics').expect(200);
    });

    it('rejects malformed Authorization header (not Basic)', async () => {
      const res = await supertest(app)
        .get('/fhir/Patient')
        .set('Authorization', 'Bearer sometoken')
        .expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('returns application/fhir+json Content-Type on 401', async () => {
      const res = await supertest(app).get('/fhir/Patient').expect(401);
      expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    });
  });

  describe('apikey mode', () => {
    const authConfig = { type: 'apikey', apiKey: 'my-secret-key', header: 'X-API-Key' };
    let app;

    beforeEach(() => {
      app = makeApp(authConfig);
    });

    it('allows a request with correct API key', async () => {
      const res = await supertest(app)
        .get('/fhir/Patient')
        .set('X-API-Key', 'my-secret-key')
        .expect(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects a request with wrong API key', async () => {
      const res = await supertest(app)
        .get('/fhir/Patient')
        .set('X-API-Key', 'wrong-key')
        .expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('rejects a request with no API key header', async () => {
      const res = await supertest(app).get('/fhir/Patient').expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('exempts /health from auth', async () => {
      await supertest(app).get('/health').expect(200);
    });

    it('exempts /ready from auth', async () => {
      await supertest(app).get('/ready').expect(200);
    });

    it('exempts /metrics from auth', async () => {
      await supertest(app).get('/metrics').expect(200);
    });

    it('uses default X-API-Key header when header is not specified', async () => {
      const defaultApp = makeApp({ type: 'apikey', apiKey: 'abc' });
      const res = await supertest(defaultApp)
        .get('/fhir/Patient')
        .set('X-API-Key', 'abc')
        .expect(200);
      expect(res.body.ok).toBe(true);
    });

    it('uses custom header name when specified', async () => {
      const customApp = makeApp({ type: 'apikey', apiKey: 'abc', header: 'X-Custom-Token' });
      await supertest(customApp).get('/fhir/Patient').set('X-Custom-Token', 'abc').expect(200);
      // X-API-Key should NOT work with a custom header
      await supertest(customApp).get('/fhir/Patient').set('X-API-Key', 'abc').expect(401);
    });
  });

  describe('unknown/missing type', () => {
    it('fails closed (401) when type is unknown', async () => {
      const app = makeApp({ type: 'oauth2' });
      const res = await supertest(app).get('/fhir/Patient').expect(401);
      expect(res.body.resourceType).toBe('OperationOutcome');
    });
  });
});
