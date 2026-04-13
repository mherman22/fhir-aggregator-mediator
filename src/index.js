'use strict';

const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const { createApp, config } = require('./server');
const { startCluster } = require('./cluster');
const mediatorConfig = require('../config/mediator.json');

const port = config.app.port || 3000;

const MAX_RETRIES = 90;
const RETRY_INTERVAL_MS = 10000; // 10 seconds (90 x 10s = 15 min)
const REQUEST_TIMEOUT_MS = (config.performance && config.performance.requestTimeoutMs) || 120000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorker() {
  const { app, fhirClient, sourceMonitor } = createApp();
  let server;

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
    console.log(`FHIR Aggregator Mediator worker ${process.pid} listening on port ${port}`);

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

  // Graceful shutdown — finish in-flight requests, close connection pools
  function shutdown(signal) {
    console.log(`${signal} received, shutting down gracefully...`);
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
        fhirClient.destroy();
        process.exit(0);
      });
      // Force exit if connections don't drain within request timeout + buffer
      const shutdownTimeoutMs = REQUEST_TIMEOUT_MS + 5000;
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, shutdownTimeoutMs);
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startCluster(startWorker, config);
