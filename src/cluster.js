'use strict';

const cluster = require('cluster');
const os = require('os');

/**
 * Cluster manager for the FHIR Aggregator Mediator.
 *
 * Forks one worker per available CPU core so that the mediator can
 * utilise all cores and avoid blocking the event-loop during
 * CPU-intensive dedup or large fan-out operations.
 *
 * Each worker runs its own Express server sharing the same port
 * (Node.js round-robin distribution on Linux, OS-level on others).
 *
 * The in-process LRU pagination cache is per-worker by design.
 * Each worker can independently re-fetch pages from upstream, so
 * stateless pagination remains correct even when a subsequent
 * _getpages request lands on a different worker.
 *
 * Enable via:
 *   - Environment variable:  CLUSTER_ENABLED=true
 *   - config.json:           { "cluster": { "enabled": true, "workers": 4 } }
 *
 * Worker count defaults to os.cpus().length but can be overridden
 * via CLUSTER_WORKERS env var or config.cluster.workers.
 */

function getWorkerCount(clusterConfig) {
  const envWorkers = process.env.CLUSTER_WORKERS;
  if (envWorkers !== undefined) {
    const n = parseInt(envWorkers, 10);
    if (!isNaN(n) && n >= 1) return n;
  }
  if (clusterConfig && clusterConfig.workers) {
    const n = parseInt(clusterConfig.workers, 10);
    if (!isNaN(n) && n >= 1) return n;
  }
  return os.cpus().length;
}

function isClusterEnabled(config) {
  const envFlag = process.env.CLUSTER_ENABLED;
  if (envFlag !== undefined) {
    return envFlag === 'true' || envFlag === '1';
  }
  return !!(config && config.cluster && config.cluster.enabled);
}

/**
 * Start the mediator in cluster mode.
 *
 * @param {Function} startWorker  – Function that boots a single worker
 *                                  (the normal server start logic).
 * @param {Object}   config       – Parsed config.json (or subset).
 */
function startCluster(startWorker, config) {
  const clusterConfig = (config && config.cluster) || {};

  if (!isClusterEnabled(config)) {
    // Clustering disabled — run in single-process mode (original behaviour)
    startWorker();
    return;
  }

  if (cluster.isPrimary) {
    const numWorkers = getWorkerCount(clusterConfig);
    console.log(`[cluster] Primary ${process.pid} forking ${numWorkers} worker(s)`);

    for (let i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      const reason = signal || code;
      console.warn(`[cluster] Worker ${worker.process.pid} exited (${reason}), restarting...`);
      cluster.fork();
    });
  } else {
    console.log(`[cluster] Worker ${process.pid} starting`);
    startWorker();
  }
}

module.exports = { startCluster, isClusterEnabled, getWorkerCount };
