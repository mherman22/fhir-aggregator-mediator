'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const { startCluster } = require('./cluster');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const SourceMonitor = require('./source-monitor');
const CircuitBreaker = require('./circuit-breaker');
const Semaphore = require('./semaphore');
const createRouter = require('./routes');
const createMetrics = require('./metrics');
const { validateConfig, applyEnvOverrides } = require('./config-validator');
const logger = require('./logger');

const config = require('../config/config.json');
const mediatorConfig = require('../config/mediator.json');

// Apply environment variable overrides (Issue 9)
applyEnvOverrides(config);

// Validate configuration on startup (Issue 9)
try {
  validateConfig(config);
} catch (err) {
  logger.fatal({ error: err.message }, 'Configuration validation failed');
  process.exit(1);
}

async function startWorker() {
  const app = express();
  const fhirClient = new FhirClient(config.performance || {});
  const paginationManager = new PaginationManager(config.pagination);
  const sourceMonitor = new SourceMonitor();
  const circuitBreaker = new CircuitBreaker(config.circuitBreaker || {});
  const metrics = createMetrics();

  // Upstream concurrency limiter — prevents fan-out storms during large batch runs
  const maxConcurrentUpstream =
    (config.performance && config.performance.maxConcurrentUpstreamRequests) || 50;
  const semaphore = new Semaphore(maxConcurrentUpstream);

  // Issue 7: Security headers via helmet
  app.use(helmet());

  // Issue 7: Request body size limits
  app.use(express.json({ limit: '1mb' }));

  // Issue 8: Response compression
  const compressionEnabled = !(config.compression && config.compression.enabled === false);
  if (compressionEnabled) {
    app.use(
      compression({
        threshold: (config.compression && config.compression.threshold) || 1024,
      })
    );
  }

  // Issue 6: Rate limiting
  if (config.rateLimiting && config.rateLimiting.enabled !== false) {
    const limiter = rateLimit({
      windowMs: (config.rateLimiting && config.rateLimiting.windowMs) || 60000,
      max: (config.rateLimiting && config.rateLimiting.maxRequests) || 100,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res
          .status(429)
          .set('Content-Type', 'application/fhir+json; charset=utf-8')
          .set('Retry-After', '60')
          .json({
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: 'error',
                code: 'throttled',
                diagnostics: 'Too many requests. Please retry after the Retry-After period.',
              },
            ],
          });
      },
    });
    app.use('/fhir', limiter);
  }

  // Issue 3: Metrics middleware
  app.use(metrics.metricsMiddleware);

  // Request-level timeout — prevents slow upstreams from hanging Express indefinitely
  const REQUEST_TIMEOUT_MS = (config.performance && config.performance.requestTimeoutMs) || 120000;
  app.use((req, res, next) => {
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
      res
        .status(504)
        .set('Content-Type', 'application/fhir+json; charset=utf-8')
        .json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'timeout', diagnostics: 'Request timed out' }],
        });
    });
    next();
  });

  const router = createRouter(
    config,
    paginationManager,
    fhirClient,
    sourceMonitor,
    circuitBreaker,
    metrics,
    semaphore
  );
  app.use(router);

  // Health endpoint — shows per-source status (with circuit breaker state, Issue 4)
  app.get('/health', (req, res) => {
    const health = sourceMonitor.getHealth(circuitBreaker);
    const statusCode = health.status === 'UP' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // Issue 10: Readiness endpoint — distinct from liveness health check
  let isReady = false;
  app.get('/ready', (req, res) => {
    if (isReady) {
      res.status(200).json({ status: 'READY' });
    } else {
      res.status(503).json({ status: 'NOT_READY', message: 'Source validation in progress' });
    }
  });

  // Issue 3: Prometheus metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', metrics.register.contentType);
      res.end(await metrics.register.metrics());
    } catch (err) {
      res.status(500).end(err.message);
    }
  });

  const port = config.app.port || 3000;
  let server;

  const MAX_RETRIES = 90;
  const RETRY_INTERVAL_MS = 10000; // 10 seconds (90 x 10s = 15 min)

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function start() {
    logger.info(
      {
        sourceCount: config.sources.length,
        sources: config.sources.map((s) => ({ id: s.id, name: s.name })),
      },
      'Validating sources'
    );

    // Retry source validation — upstream services (e.g. iSantePlus) may take
    // 10-15 minutes to boot after a fresh deployment
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await sourceMonitor.validateAll(config.sources, fhirClient);
        logger.info('All sources validated successfully');
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        logger.warn(
          { attempt, maxRetries: MAX_RETRIES, error: err.message.split('\n')[0] },
          'Source validation attempt failed, retrying'
        );
        await sleep(RETRY_INTERVAL_MS);
      }
    }

    if (lastError) {
      logger.fatal(
        { attempts: MAX_RETRIES, error: lastError.message },
        'Failed to validate sources'
      );
      process.exit(1);
    }

    // Mark as ready after successful validation (Issue 10)
    isReady = true;

    server = app.listen(port, () => {
      logger.info({ port, pid: process.pid }, 'FHIR Aggregator Mediator listening');

      registerMediator(config.mediator.api, mediatorConfig, (err) => {
        if (err) {
          logger.error({ error: err.message }, 'Failed to register mediator with OpenHIM');
          logger.info('Mediator will continue running without OpenHIM registration');
        } else {
          logger.info('Mediator registered with OpenHIM');
          activateHeartbeat(config.mediator.api);
        }
      });
    });
  }

  // Graceful shutdown — finish in-flight requests, close connection pools
  function shutdown(signal) {
    logger.info({ signal }, 'Shutting down gracefully');
    if (server) {
      server.close(() => {
        logger.info('HTTP server closed');
        fhirClient.destroy();
        process.exit(0);
      });
      // Force exit if connections don't drain within request timeout + buffer
      const shutdownTimeoutMs =
        ((config.performance && config.performance.requestTimeoutMs) || REQUEST_TIMEOUT_MS) + 5000;
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, shutdownTimeoutMs);
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  start();
}

startCluster(startWorker, config);
