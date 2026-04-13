'use strict';

const express = require('express');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const SourceMonitor = require('./source-monitor');
const createRouter = require('./routes');

const config = require('../config/config.json');

// Support environment variable overrides for credentials
// e.g. SOURCE_isanteplus_PASSWORD=secret overrides source "isanteplus" password
config.sources.forEach((source) => {
  const envUser = process.env[`SOURCE_${source.id}_USERNAME`];
  const envPass = process.env[`SOURCE_${source.id}_PASSWORD`];
  if (envUser !== undefined) source.username = envUser;
  if (envPass !== undefined) source.password = envPass;
});

// Support environment variable overrides for OpenHIM mediator API credentials
if (config.mediator && config.mediator.api) {
  const ohimUser = process.env.OPENHIM_API_USERNAME;
  const ohimPass = process.env.OPENHIM_API_PASSWORD;
  const ohimUrl = process.env.OPENHIM_API_URL;
  if (ohimUser !== undefined) config.mediator.api.username = ohimUser;
  if (ohimPass !== undefined) config.mediator.api.password = ohimPass;
  if (ohimUrl !== undefined) config.mediator.api.apiURL = ohimUrl;
}

function createApp() {
  const app = express();
  const fhirClient = new FhirClient(config.performance || {});
  const paginationManager = new PaginationManager(config.pagination);
  const sourceMonitor = new SourceMonitor();
  const router = createRouter(config, paginationManager, fhirClient, sourceMonitor);

  // Request-level timeout — prevents slow upstreams from hanging Express indefinitely
  const REQUEST_TIMEOUT_MS = (config.performance && config.performance.requestTimeoutMs) || 120000;
  app.use((req, res, next) => {
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
      res
        .status(504)
        .set('Content-Type', 'application/fhir+json; charset=utf-8')
        .json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'timeout', diagnostics: 'Request timed out' }],
        });
    });
    next();
  });

  app.use(router);

  // Health endpoint — shows per-source status
  app.get('/health', (req, res) => {
    const health = sourceMonitor.getHealth();
    const statusCode = health.status === 'UP' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  return { app, fhirClient, sourceMonitor };
}

module.exports = { createApp, config };
