'use strict';

const logger = require('./logger');

/**
 * Remove duplicate entries that have the same resourceType/id.
 * This is NOT clinical deduplication (that's OpenCR's job).
 * This prevents HAPI FHIR from rejecting transaction bundles that
 * contain the same resource twice — which happens when multiple
 * sources share cloned reference data (e.g. same Practitioner/Location).
 *
 * Returns { entries, removedCount }.
 */
function removeDuplicateIds(entries) {
  const seen = new Set();
  let removedCount = 0;
  const unique = entries.filter((entry) => {
    if (!entry.resource || !entry.resource.id) return true;
    const key = `${entry.resource.resourceType}/${entry.resource.id}`;
    if (seen.has(key)) {
      removedCount++;
      return false;
    }
    seen.add(key);
    return true;
  });
  return { entries: unique, removedCount };
}

function extractGetpagesToken(nextUrl) {
  if (!nextUrl) return null;
  try {
    const parsed = new URL(nextUrl);
    return parsed.searchParams.get('_getpages');
  } catch {
    logger.error({ nextUrl }, 'Failed to parse next-link URL');
    return null;
  }
}

/**
 * Build extra headers to propagate to upstream requests.
 * Only adds X-Correlation-ID when a correlationId is provided.
 */
function buildUpstreamHeaders(correlationId) {
  if (!correlationId) return {};
  return { 'X-Correlation-ID': correlationId };
}

/**
 * Acquire a semaphore slot (if a semaphore is configured), run fn, then release.
 */
async function withSemaphore(semaphore, fn) {
  if (semaphore) await semaphore.acquire();
  try {
    return await fn();
  } finally {
    if (semaphore) semaphore.release();
  }
}

/**
 * Fan out a FHIR search to all configured sources in parallel.
 *
 * @param {string}   path          - e.g. '/Patient'
 * @param {Object}   queryParams   - FHIR search parameters
 * @param {Array}    sources       - configured source objects
 * @param {FhirClient} fhirClient
 * @param {SourceMonitor} sourceMonitor
 * @param {CircuitBreaker} circuitBreaker
 * @param {Object}   options
 * @param {Object}   [options.metrics]       - createMetrics() result
 * @param {string}   [options.correlationId] - per-request UUID for tracing
 * @param {Semaphore}[options.semaphore]     - upstream concurrency limiter
 * @param {boolean}  [options.strictMode]    - fail request if any source fails
 */
async function searchAll(
  path,
  queryParams,
  sources,
  fhirClient,
  sourceMonitor,
  circuitBreaker,
  options = {}
) {
  const { metrics, correlationId, semaphore, strictMode } = options;
  const extraHeaders = buildUpstreamHeaders(correlationId);

  const promises = sources.map((source) => {
    // Circuit breaker: skip sources with open circuits
    if (circuitBreaker && !circuitBreaker.allowRequest(source.id)) {
      logger.warn(
        { sourceId: source.id, sourceName: source.name, correlationId },
        'Circuit breaker OPEN — skipping source'
      );
      return Promise.resolve(null);
    }

    return withSemaphore(semaphore, () => {
      const startMs = Date.now();
      return fhirClient
        .search(source, path, queryParams, extraHeaders)
        .then((result) => {
          if (sourceMonitor) sourceMonitor.recordSuccess(source.id);
          if (circuitBreaker) circuitBreaker.recordSuccess(source.id);
          if (metrics) {
            const durationSec = (Date.now() - startMs) / 1000;
            metrics.upstreamRequestDuration
              .labels({ source_id: source.id, resource_type: path.replace(/^\//, '') })
              .observe(durationSec);
          }
          return result;
        })
        .catch((err) => {
          if (sourceMonitor) sourceMonitor.recordFailure(source.id, err);
          if (circuitBreaker) circuitBreaker.recordFailure(source.id);
          if (metrics) {
            const errType = err.response ? `http_${err.response.status}` : err.code || 'network';
            metrics.upstreamErrorsTotal.labels({ source_id: source.id, error_type: errType }).inc();
          }
          logger.error(
            { sourceId: source.id, sourceName: source.name, correlationId, error: err.message },
            'Source request failed'
          );
          return null;
        });
    });
  });

  const results = await Promise.all(promises);

  const allEntries = [];
  let totalCount = 0;
  const sourceTokens = {};
  const failedSources = [];

  for (let i = 0; i < results.length; i++) {
    const bundle = results[i];
    const source = sources[i];

    if (!bundle) {
      failedSources.push(source.id);
      continue;
    }

    allEntries.push(...(bundle.entry || []));
    totalCount += bundle.total || (bundle.entry || []).length;

    const links = Array.isArray(bundle.link) ? bundle.link : [];
    const nextLink = links.find((l) => l.relation === 'next');
    if (nextLink) {
      const token = extractGetpagesToken(nextLink.url);
      if (token) {
        // Only store the upstream page token — baseUrl is looked up from config
        sourceTokens[source.id] = token;
      }
    }
  }

  if (strictMode && failedSources.length > 0) {
    const err = new Error(
      `Strict mode: ${failedSources.length} source(s) failed: ${failedSources.join(', ')}`
    );
    err.failedSources = failedSources;
    err.isStrictModeFailure = true;
    throw err;
  }

  const { entries: uniqueEntries, removedCount } = removeDuplicateIds(allEntries);
  if (metrics && removedCount > 0) {
    metrics.dedupRemovedTotal.inc(removedCount);
  }
  const hasMore = Object.keys(sourceTokens).length > 0;

  // When all results fit in one page, use the actual entry count as total.
  // The raw totalCount (sum of all sources) overestimates when duplicates
  // were removed. If we report total > entries with no next link,
  // fhir-data-pipes tries to paginate and fails.
  const adjustedTotal = hasMore ? totalCount : uniqueEntries.length;

  return {
    entries: uniqueEntries,
    totalCount: adjustedTotal,
    sourceTokens,
    hasMore,
    failedSources,
  };
}

/**
 * Fetch the next page for sources that had a next link.
 *
 * @param {Object}  state   - Map of sourceId → upstream _getpages token string
 * @param {number}  offset
 * @param {number}  count
 * @param {Array}   sources - all configured source objects (for baseUrl lookup)
 * @param {FhirClient} fhirClient
 * @param {SourceMonitor} sourceMonitor
 * @param {CircuitBreaker} circuitBreaker
 * @param {Object}  options
 */
async function fetchWithOffset(
  state,
  offset,
  count,
  sources,
  fhirClient,
  sourceMonitor,
  circuitBreaker,
  options = {}
) {
  const { metrics, correlationId, semaphore } = options;
  const extraHeaders = buildUpstreamHeaders(correlationId);

  // Only fetch from sources that appeared in the original page result
  const activeSources = sources.filter((s) => state[s.id]);
  const failedSources = [];

  const promises = activeSources.map((source) => {
    // Circuit breaker: skip sources with open circuits
    if (circuitBreaker && !circuitBreaker.allowRequest(source.id)) {
      logger.warn(
        { sourceId: source.id, correlationId },
        'Circuit breaker OPEN — skipping offset fetch'
      );
      failedSources.push(source.id);
      return Promise.resolve(null);
    }

    // Build the upstream pagination URL using the source's configured baseUrl
    // (not stored in the token, to prevent SSRF via crafted tokens)
    const fetchUrl =
      `${source.baseUrl}?_getpages=${state[source.id]}` +
      `&_getpagesoffset=${offset}` +
      `&_count=${count}`;

    return withSemaphore(semaphore, () => {
      const startMs = Date.now();
      return fhirClient
        .fetchUrl(source, fetchUrl, extraHeaders)
        .then((result) => {
          if (sourceMonitor) sourceMonitor.recordSuccess(source.id);
          if (circuitBreaker) circuitBreaker.recordSuccess(source.id);
          if (metrics) {
            const durationSec = (Date.now() - startMs) / 1000;
            metrics.upstreamRequestDuration
              .labels({ source_id: source.id, resource_type: 'pagination' })
              .observe(durationSec);
          }
          return result;
        })
        .catch((err) => {
          if (sourceMonitor) sourceMonitor.recordFailure(source.id, err);
          if (circuitBreaker) circuitBreaker.recordFailure(source.id);
          if (metrics) {
            const errType = err.response ? `http_${err.response.status}` : err.code || 'network';
            metrics.upstreamErrorsTotal.labels({ source_id: source.id, error_type: errType }).inc();
          }
          failedSources.push(source.id);
          logger.error(
            { sourceId: source.id, correlationId, error: err.message },
            'Offset fetch failed'
          );
          return null;
        });
    });
  });

  const results = await Promise.all(promises);

  const allEntries = [];
  for (const bundle of results) {
    if (!bundle) continue;
    allEntries.push(...(bundle.entry || []));
  }

  const { entries, removedCount } = removeDuplicateIds(allEntries);
  if (metrics && removedCount > 0) {
    metrics.dedupRemovedTotal.inc(removedCount);
  }

  return { entries, failedSources };
}

module.exports = { searchAll, fetchWithOffset };
