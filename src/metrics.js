'use strict';

const client = require('prom-client');

/**
 * Prometheus metrics for the FHIR Aggregator Mediator (Issue 3).
 *
 * Exposes request duration, error counts, upstream latency, and
 * pagination cache statistics.
 */
function createMetrics() {
  // Create a new registry (isolates from default registry for testability)
  const register = new client.Registry();

  // Collect default metrics (GC, event loop, memory, etc.)
  client.collectDefaultMetrics({ register });

  // --- Inbound HTTP metrics ---
  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of inbound HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register],
  });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of inbound HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const activeRequests = new client.Gauge({
    name: 'active_requests',
    help: 'Number of currently in-flight requests',
    registers: [register],
  });

  // --- Upstream metrics ---
  const upstreamRequestDuration = new client.Histogram({
    name: 'upstream_request_duration_seconds',
    help: 'Duration of upstream FHIR server requests in seconds',
    labelNames: ['source_id', 'resource_type'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register],
  });

  const upstreamErrorsTotal = new client.Counter({
    name: 'upstream_errors_total',
    help: 'Total upstream FHIR server errors',
    labelNames: ['source_id', 'error_type'],
    registers: [register],
  });

  // --- Pagination cache metrics ---
  const paginationCacheSize = new client.Gauge({
    name: 'pagination_cache_size',
    help: 'Current number of entries in the pagination LRU cache',
    registers: [register],
  });

  const paginationCacheHits = new client.Counter({
    name: 'pagination_cache_hits_total',
    help: 'Total pagination cache hits',
    registers: [register],
  });

  const paginationCacheMisses = new client.Counter({
    name: 'pagination_cache_misses_total',
    help: 'Total pagination cache misses',
    registers: [register],
  });

  // --- Deduplication metrics ---
  const dedupRemovedTotal = new client.Counter({
    name: 'dedup_removed_total',
    help: 'Total duplicate entries removed during aggregation',
    registers: [register],
  });

  /**
   * Express middleware to track request duration and active requests.
   */
  function metricsMiddleware(req, res, next) {
    activeRequests.inc();
    const end = httpRequestDuration.startTimer();

    res.on('finish', () => {
      activeRequests.dec();
      const route = req.route ? req.route.path : req.path;
      const labels = {
        method: req.method,
        route: route,
        status_code: res.statusCode,
      };
      end(labels);
      httpRequestsTotal.inc(labels);
    });

    next();
  }

  return {
    register,
    metricsMiddleware,
    httpRequestDuration,
    httpRequestsTotal,
    activeRequests,
    upstreamRequestDuration,
    upstreamErrorsTotal,
    paginationCacheSize,
    paginationCacheHits,
    paginationCacheMisses,
    dedupRemovedTotal,
  };
}

module.exports = createMetrics;
