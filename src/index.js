'use strict';

const express = require('express');
const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const SourceMonitor = require('./source-monitor');
const createRouter = require('./routes');

const config = require('../config/config.json');
const mediatorConfig = require('../config/mediator.json');

const app = express();
const fhirClient = new FhirClient();
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

async function start() {
  console.log(
    `Validating ${config.sources.length} sources:`,
    config.sources.map((s) => `${s.id} (${s.name})`).join(', ')
  );

  // Validate all source credentials on startup — fail fast if any are wrong
  try {
    await sourceMonitor.validateAll(config.sources, fhirClient);
    console.log('All sources validated successfully');
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    console.error('Fix source credentials in config/config.json and restart');
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`FHIR Aggregator Mediator listening on port ${port}`);

    // Register with OpenHIM
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

start();
