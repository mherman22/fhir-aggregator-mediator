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

const MAX_RETRIES = 90;
const RETRY_INTERVAL_MS = 10000; // 10 seconds (90 x 10s = 15 min)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function start() {
  console.log(
    `Validating ${config.sources.length} sources:`,
    config.sources.map((s) => `${s.id} (${s.name})`).join(', ')
  );

  // Retry source validation — upstream services (e.g. iSantePlus) may take
  // 10-15 minutes to boot after a fresh deployment
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sourceMonitor.validateAll(config.sources, fhirClient);
      console.log('All sources validated successfully');
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(
        `Attempt ${attempt}/${MAX_RETRIES}: ${err.message.split('\n')[0]}. Retrying in ${RETRY_INTERVAL_MS / 1000}s...`
      );
      await sleep(RETRY_INTERVAL_MS);
    }
  }

  if (lastError) {
    console.error(`FATAL: Failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
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
