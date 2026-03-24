'use strict';

const express = require('express');
const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const createRouter = require('./routes');

const config = require('../config/config.json');
const mediatorConfig = require('../config/mediator.json');

const app = express();
const fhirClient = new FhirClient();
const paginationManager = new PaginationManager(config.pagination);
const router = createRouter(config, paginationManager, fhirClient);

app.use(router);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    sources: config.sources.map((s) => ({ id: s.id, name: s.name })),
  });
});

const port = config.app.port || 3000;
app.listen(port, () => {
  console.log(`FHIR Aggregator Mediator listening on port ${port}`);
  console.log(
    `Aggregating ${config.sources.length} sources:`,
    config.sources.map((s) => s.id).join(', ')
  );

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
