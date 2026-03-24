'use strict';

const express = require('express');
const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const SourceMonitor = require('./source-monitor');
const createRouter = require('./routes');

const config = require('../config/config.json');
const mediatorConfig = require('../config/mediator.json');

// Support environment variable overrides for credentials
// e.g. SOURCE_isanteplus_PASSWORD=secret overrides source "isanteplus" password
config.sources.forEach((source) => {
  const envUser = process.env[`SOURCE_${source.id}_USERNAME`];
  const envPass = process.env[`SOURCE_${source.id}_PASSWORD`];
  if (envUser !== undefined) source.username = envUser;
  if (envPass !== undefined) source.password = envPass;
});

const app = express();
const fhirClient = new FhirClient(config.performance || {});
const paginationManager = new PaginationManager(config.pagination);
const sourceMonitor = new SourceMonitor();
const router = createRouter(config, paginationManager, fhirClient, sourceMonitor);

app.use(router);

// Health endpoint — shows per-source status
app.get('/health', (req, res) => {
  const health = sourceMonitor.getHealth();
  const statusCode = health.status === 'UP' ? 200 : 503;
  res.status(statusCode).json(health);
});

const port = config.app.port || 3000;
let server;

async function start() {
  console.log(
    `Validating ${config.sources.length} sources:`,
    config.sources.map((s) => `${s.id} (${s.name})`).join(', ')
  );

  try {
    await sourceMonitor.validateAll(config.sources, fhirClient);
    console.log('All sources validated successfully');
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    console.error('Fix source credentials in config/config.json and restart');
    process.exit(1);
  }

  server = app.listen(port, () => {
    console.log(`FHIR Aggregator Mediator listening on port ${port}`);

    registerMediator(config.mediator.api, mediatorConfig, (err) => {
      if (err) {
        console.error('Failed to register mediator with OpenHIM:', err.message);
        console.log('Mediator will continue running without OpenHIM registration');
      } else {
        console.log('Mediator registered with OpenHIM');
        activateHeartbeat(config.mediator.api);
      }
    });
  });
}

// Graceful shutdown — finish in-flight requests, close connection pools
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      fhirClient.destroy();
      process.exit(0);
    });
    // Force exit after 10 seconds if connections don't drain
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
