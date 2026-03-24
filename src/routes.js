'use strict';

const express = require('express');
const aggregator = require('./aggregator');

function buildBundle(entries, totalCount, paginationToken, baseUrl) {
  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: totalCount,
    entry: entries,
    link: [{ relation: 'self', url: baseUrl }],
  };

  if (paginationToken) {
    bundle.link.push({
      relation: 'next',
      url: `${baseUrl.split('?')[0].replace(/\/[^/]+$/, '')}?_getpages=${paginationToken}`,
    });
  }

  return bundle;
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

function createRouter(config, paginationManager, fhirClient) {
  const router = express.Router();

  router.get('/fhir/metadata', (req, res) => {
    res.json({
      resourceType: 'CapabilityStatement',
      status: 'active',
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      software: {
        name: 'FHIR Aggregator Mediator',
        version: '1.0.0',
      },
      implementation: {
        description: `Aggregates ${config.sources.length} iSantePlus instances`,
        url: `${req.protocol}://${req.get('host')}/fhir`,
      },
      rest: [
        {
          mode: 'server',
          resource: [
            'Location', 'Patient', 'Encounter', 'Observation', 'Condition',
            'AllergyIntolerance', 'MedicationRequest', 'Practitioner', 'Group',
          ].map((type) => ({
            type,
            interaction: [{ code: 'search-type' }, { code: 'read' }],
          })),
        },
      ],
    });
  });

  // /fhir?_getpages=<token> — pagination continuation
  router.get('/fhir', async (req, res) => {
    if (!req.query._getpages) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'invalid',
            diagnostics: 'Use /fhir/:resourceType to search. /fhir requires _getpages.',
          },
        ],
      });
    }

    const token = req.query._getpages;
    const state = paginationManager.getState(token);
    if (!state) {
      return res.status(410).json({
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'expired',
            diagnostics: 'Pagination token expired or invalid',
          },
        ],
      });
    }

    try {
      const { entries, totalCount, nextPages } = await aggregator.fetchNextPages(
        state,
        config.sources,
        fhirClient
      );
      const newToken = paginationManager.createToken(nextPages);
      const bundle = buildBundle(entries, totalCount, newToken, getBaseUrl(req));
      res.json(bundle);
    } catch (err) {
      console.error('[routes] Pagination error:', err.message);
      res.status(500).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: err.message }],
      });
    }
  });

  // /fhir/:resourceType — initial search, fan out to all sources
  router.get('/fhir/:resourceType', async (req, res) => {
    const { resourceType } = req.params;
    const queryParams = { ...req.query };

    console.log(
      `[routes] Search ${resourceType} from ${config.sources.length} sources, params:`,
      queryParams
    );

    try {
      const { entries, totalCount, nextPages } = await aggregator.searchAll(
        `/${resourceType}`,
        queryParams,
        config.sources,
        fhirClient
      );
      const token = paginationManager.createToken(nextPages);
      const bundle = buildBundle(entries, totalCount, token, getBaseUrl(req));
      console.log(
        `[routes] Returning ${entries.length} entries, total=${totalCount}, hasMore=${!!token}`
      );
      res.json(bundle);
    } catch (err) {
      console.error(`[routes] Search error for ${resourceType}:`, err.message);
      res.status(500).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: err.message }],
      });
    }
  });

  return router;
}

module.exports = createRouter;
