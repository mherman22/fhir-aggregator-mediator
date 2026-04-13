'use strict';

const express = require('express');
const aggregator = require('./aggregator');
const logger = require('./logger');

// FHIR R4 resource types — used to validate the :resourceType parameter
// and advertised in the CapabilityStatement.
const SUPPORTED_RESOURCE_TYPES = [
  'Account',
  'ActivityDefinition',
  'AdverseEvent',
  'AllergyIntolerance',
  'Appointment',
  'AppointmentResponse',
  'AuditEvent',
  'Basic',
  'Binary',
  'BiologicallyDerivedProduct',
  'BodyStructure',
  'Bundle',
  'CapabilityStatement',
  'CarePlan',
  'CareTeam',
  'CatalogEntry',
  'ChargeItem',
  'ChargeItemDefinition',
  'Claim',
  'ClaimResponse',
  'ClinicalImpression',
  'CodeSystem',
  'Communication',
  'CommunicationRequest',
  'CompartmentDefinition',
  'Composition',
  'ConceptMap',
  'Condition',
  'Consent',
  'Contract',
  'Coverage',
  'CoverageEligibilityRequest',
  'CoverageEligibilityResponse',
  'DetectedIssue',
  'Device',
  'DeviceDefinition',
  'DeviceMetric',
  'DeviceRequest',
  'DeviceUseStatement',
  'DiagnosticReport',
  'DocumentManifest',
  'DocumentReference',
  'EffectEvidenceSynthesis',
  'Encounter',
  'Endpoint',
  'EnrollmentRequest',
  'EnrollmentResponse',
  'EpisodeOfCare',
  'EventDefinition',
  'Evidence',
  'EvidenceVariable',
  'ExampleScenario',
  'ExplanationOfBenefit',
  'FamilyMemberHistory',
  'Flag',
  'Goal',
  'GraphDefinition',
  'Group',
  'GuidanceResponse',
  'HealthcareService',
  'ImagingStudy',
  'Immunization',
  'ImmunizationEvaluation',
  'ImmunizationRecommendation',
  'ImplementationGuide',
  'InsurancePlan',
  'Invoice',
  'Library',
  'Linkage',
  'List',
  'Location',
  'Measure',
  'MeasureReport',
  'Media',
  'Medication',
  'MedicationAdministration',
  'MedicationDispense',
  'MedicationKnowledge',
  'MedicationRequest',
  'MedicationStatement',
  'MedicinalProduct',
  'MedicinalProductAuthorization',
  'MedicinalProductContraindication',
  'MedicinalProductIndication',
  'MedicinalProductIngredient',
  'MedicinalProductInteraction',
  'MedicinalProductManufactured',
  'MedicinalProductPackaged',
  'MedicinalProductPharmaceutical',
  'MedicinalProductUndesirableEffect',
  'MessageDefinition',
  'MessageHeader',
  'MolecularSequence',
  'NamingSystem',
  'NutritionOrder',
  'Observation',
  'ObservationDefinition',
  'OperationDefinition',
  'OperationOutcome',
  'Organization',
  'OrganizationAffiliation',
  'Patient',
  'PaymentNotice',
  'PaymentReconciliation',
  'Person',
  'PlanDefinition',
  'Practitioner',
  'PractitionerRole',
  'Procedure',
  'Provenance',
  'Questionnaire',
  'QuestionnaireResponse',
  'RelatedPerson',
  'RequestGroup',
  'ResearchDefinition',
  'ResearchElementDefinition',
  'ResearchStudy',
  'ResearchSubject',
  'RiskAssessment',
  'RiskEvidenceSynthesis',
  'Schedule',
  'SearchParameter',
  'ServiceRequest',
  'Slot',
  'Specimen',
  'SpecimenDefinition',
  'StructureDefinition',
  'StructureMap',
  'Subscription',
  'Substance',
  'SubstanceNucleicAcid',
  'SubstancePolymer',
  'SubstanceProtein',
  'SubstanceReferenceInformation',
  'SubstanceSourceMaterial',
  'SubstanceSpecification',
  'SupplyDelivery',
  'SupplyRequest',
  'Task',
  'TerminologyCapabilities',
  'TestReport',
  'TestScript',
  'ValueSet',
  'VerificationResult',
  'VisionPrescription',
];
const VALID_RESOURCE_TYPE_SET = new Set(SUPPORTED_RESOURCE_TYPES);

const MAX_COUNT = 500;
const DEFAULT_COUNT = 20;
const MAX_QUERY_PARAMS = 50;

// Known FHIR search parameters that are safe to forward (Issue 12)
const KNOWN_FHIR_PARAMS = new Set([
  '_count',
  '_since',
  '_lastUpdated',
  '_sort',
  '_include',
  '_revinclude',
  '_summary',
  '_elements',
  '_contained',
  '_containedType',
  '_total',
  '_format',
  '_pretty',
  '_type',
  '_id',
  '_tag',
  '_security',
  '_profile',
  '_has',
  '_list',
  '_text',
  '_content',
  '_filter',
  '_at',
  '_page',
  '_getpages',
  '_getpagesoffset',
  '_bundletype',
]);

/**
 * Sanitize a string for safe logging — strip control characters (Issue 12).
 */
function sanitizeForLog(str) {
  if (typeof str !== 'string') return String(str);
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1f\x7f]/g, '');
}

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
      url: `${fhirBase}?_getpages=${paginationToken}&_getpagesoffset=${count || DEFAULT_COUNT}&_count=${count || DEFAULT_COUNT}&_bundletype=searchset`,
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

function parseCount(raw) {
  const count = parseInt(raw || String(DEFAULT_COUNT), 10);
  if (isNaN(count) || count < 1) return DEFAULT_COUNT;
  return Math.min(count, MAX_COUNT);
}

function fhirJson(res, statusCode, body) {
  res.status(statusCode).set('Content-Type', 'application/fhir+json; charset=utf-8').json(body);
}

/**
 * Validate and sanitize query parameters (Issue 12).
 * Returns { valid: true, params } or { valid: false, error }.
 */
function validateQueryParams(query) {
  const keys = Object.keys(query);

  // Limit total number of query parameters
  if (keys.length > MAX_QUERY_PARAMS) {
    return { valid: false, error: `Too many query parameters (max ${MAX_QUERY_PARAMS})` };
  }

  // Validate parameter names — allow known FHIR params and resource-specific search params
  // Resource-specific params don't start with _ so we only block unknown _ params
  for (const key of keys) {
    if (key.startsWith('_') && !KNOWN_FHIR_PARAMS.has(key)) {
      return { valid: false, error: `Unknown FHIR search parameter: ${sanitizeForLog(key)}` };
    }
    // Limit individual parameter value length to prevent abuse
    const value = query[key];
    if (typeof value === 'string' && value.length > 2000) {
      return { valid: false, error: `Parameter value too long for: ${sanitizeForLog(key)}` };
    }
  }

  return { valid: true };
}

function createRouter(
  config,
  paginationManager,
  fhirClient,
  sourceMonitor,
  circuitBreaker,
  metrics
) {
  const router = express.Router();

  // /fhir/metadata
  router.get('/fhir/metadata', (req, res) => {
    fhirJson(res, 200, {
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
        description: `Aggregates ${config.sources.length} FHIR server(s)`,
        url: `${req.protocol}://${req.get('host')}/fhir`,
      },
      rest: [
        {
          mode: 'server',
          resource: SUPPORTED_RESOURCE_TYPES.map((type) => ({
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
      return fhirJson(res, 400, {
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
    const count = parseCount(req.query._count);

    const state = paginationManager.getState(token);
    if (!state) {
      if (metrics) metrics.paginationCacheMisses.inc();
      return fhirJson(res, 410, {
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
    if (metrics) metrics.paginationCacheHits.inc();

    try {
      const { entries, failedSources } = await aggregator.fetchWithOffset(
        state,
        offset,
        count,
        config.sources,
        fhirClient,
        sourceMonitor,
        circuitBreaker
      );
      setFailureHeaders(res, failedSources);
      const bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: entries,
        link: [{ relation: 'self', url: getBaseUrl(req) }],
      };
      fhirJson(res, 200, bundle);
    } catch (err) {
      logger.error({ error: err.message }, 'Pagination error');
      fhirJson(res, 500, {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: 'Internal server error' }],
      });
    }
  });

  // /fhir/:resourceType
  router.get('/fhir/:resourceType', async (req, res) => {
    const { resourceType } = req.params;

    if (!VALID_RESOURCE_TYPE_SET.has(resourceType)) {
      return fhirJson(res, 400, {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'not-supported',
            diagnostics: `Unsupported resource type: ${sanitizeForLog(resourceType)}`,
          },
        ],
      });
    }

    // Validate query parameters (Issue 12)
    const validation = validateQueryParams(req.query);
    if (!validation.valid) {
      return fhirJson(res, 400, {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'invalid',
            diagnostics: validation.error,
          },
        ],
      });
    }

    const queryParams = { ...req.query };
    const count = parseCount(queryParams._count);
    queryParams._count = String(count);
    const startTime = Date.now();

    try {
      const { entries, totalCount, sourceTokens, hasMore, failedSources } =
        await aggregator.searchAll(
          `/${resourceType}`,
          queryParams,
          config.sources,
          fhirClient,
          sourceMonitor,
          circuitBreaker
        );
      setFailureHeaders(res, failedSources);
      const token = hasMore ? paginationManager.createToken(sourceTokens) : null;
      const bundle = buildBundle(entries, totalCount, token, getBaseUrl(req), count);
      const elapsed = Date.now() - startTime;

      logger.info(
        {
          resourceType,
          entryCount: entries.length,
          total: totalCount,
          responseTimeMs: elapsed,
          failedSources: failedSources.length > 0 ? failedSources : undefined,
        },
        'Search completed'
      );

      fhirJson(res, 200, bundle);
    } catch (err) {
      logger.error({ resourceType, error: err.message }, 'Search error');
      fhirJson(res, 500, {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: 'Internal server error' }],
      });
    }
  });

  return router;
}

module.exports = createRouter;
module.exports.SUPPORTED_RESOURCE_TYPES = SUPPORTED_RESOURCE_TYPES;
