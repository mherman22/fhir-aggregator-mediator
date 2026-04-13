'use strict';

const cluster = require('cluster');
const os = require('os');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { registerMediator, activateHeartbeat } = require('openhim-mediator-utils');
const FhirClient = require('./fhir-client');
const PaginationManager = require('./pagination');
const SourceMonitor = require('./source-monitor');
const CircuitBreaker = require('./circuit-breaker');
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

// Issue 1: Clustering support
const ENABLE_CLUSTERING = process.env.CLUSTER_ENABLED === 'true';
const numWorkers = parseInt(process.env.CLUSTER_WORKERS || String(os.cpus().length), 10);

if (ENABLE_CLUSTERING && cluster.isPrimary) {
  logger.info({ workers: numWorkers }, 'Starting cluster');

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(
      { workerId: worker.id, pid: worker.process.pid, code, signal },
      'Worker exited, restarting'
    );
    cluster.fork();
  });

  // Graceful shutdown of all workers
  const shutdownCluster = (signal) => {
    logger.info({ signal }, 'Shutting down cluster');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill(signal);
    }
    setTimeout(() => process.exit(0), 10000);
  };

  process.on('SIGTERM', () => shutdownCluster('SIGTERM'));
  process.on('SIGINT', () => shutdownCluster('SIGINT'));
} else {
  // Single worker or non-clustered mode
  startWorker();
}

function startWorker() {
  const app = express();
  const fhirClient = new FhirClient(config.performance || {});
  const paginationManager = new PaginationManager(config.pagination);
  const sourceMonitor = new SourceMonitor();
  const circuitBreaker = new CircuitBreaker(config.circuitBreaker || {});
  const metrics = createMetrics();

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
    metrics
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
      // Update pagination cache size gauge
      metrics.paginationCacheSize.set(paginationManager.cache.size);
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
      logger.info(
        { port, workerId: cluster.worker ? cluster.worker.id : 'primary' },
        'FHIR Aggregator Mediator listening'
      );

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
