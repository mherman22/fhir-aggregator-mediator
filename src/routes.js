'use strict';

const express = require('express');
const aggregator = require('./aggregator');

function buildBundle(entries, totalCount, paginationToken, baseUrl, count) {
  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: totalCount,
    entry: entries,
    link: [{ relation: 'self', url: baseUrl }],
  };

  if (paginationToken) {
    const fhirBase = baseUrl.split('?')[0].replace(/\/[^/]+$/, '');
    bundle.link.push({
      relation: 'next',
      url: `${fhirBase}?_getpages=${paginationToken}&_getpagesoffset=${count || 20}&_count=${count || 20}&_bundletype=searchset`,
    });
  }

  return bundle;
}

function setFailureHeaders(res, failedSources) {
  if (failedSources && failedSources.length > 0) {
    res.set('X-Aggregator-Sources-Failed', failedSources.join(','));
    res.set('X-Aggregator-Sources-Failed-Count', String(failedSources.length));
  }
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

function createRouter(config, paginationManager, fhirClient, sourceMonitor) {
  const router = express.Router();

  // /fhir/metadata
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
            'Location',
            'Patient',
            'Encounter',
            'Observation',
            'Condition',
            'AllergyIntolerance',
            'MedicationRequest',
            'Practitioner',
            'Group',
          ].map((type) => ({
            type,
            interaction: [{ code: 'search-type' }, { code: 'read' }],
          })),
        },
      ],
    });
  });

  // /fhir?_getpages=<token>&_getpagesoffset=N&_count=M
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
    const offset = parseInt(req.query._getpagesoffset || '0', 10);
    const count = parseInt(req.query._count || '20', 10);

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
      const { entries, failedSources } = await aggregator.fetchWithOffset(
        state,
        offset,
        count,
        config.sources,
        fhirClient,
        sourceMonitor
      );
      setFailureHeaders(res, failedSources);
      const bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: entries,
        link: [{ relation: 'self', url: getBaseUrl(req) }],
      };
      res.json(bundle);
    } catch (err) {
      console.error('[routes] Pagination error:', err.message);
      res.status(500).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: err.message }],
      });
    }
  });

  // /fhir/:resourceType
  router.get('/fhir/:resourceType', async (req, res) => {
    const { resourceType } = req.params;
    const queryParams = { ...req.query };
    const count = parseInt(queryParams._count || '20', 10);
    const startTime = Date.now();

    try {
      const { entries, totalCount, sourceTokens, hasMore, failedSources } =
        await aggregator.searchAll(
          `/${resourceType}`,
          queryParams,
          config.sources,
          fhirClient,
          sourceMonitor
        );
      setFailureHeaders(res, failedSources);
      const token = hasMore ? paginationManager.createToken(sourceTokens) : null;
      const bundle = buildBundle(entries, totalCount, token, getBaseUrl(req), count);
      const elapsed = Date.now() - startTime;
      console.log(
        `[routes] ${resourceType}: ${entries.length} entries, total=${totalCount}, ${elapsed}ms` +
          (failedSources.length > 0 ? `, FAILED: ${failedSources.join(',')}` : '')
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
