'use strict';

const logger = require('./logger');

/**
 * Tracks per-source health status. Validates credentials on startup
 * and records per-request failures for the health endpoint.
 */
class SourceMonitor {
  constructor() {
    // { sourceId: { status: 'UP'|'DOWN'|'AUTH_FAILED', lastError: '...', lastChecked: Date } }
    this.status = {};
  }

  /**
   * Validate all sources on startup by hitting /metadata.
   * Throws if any source fails authentication — fail fast.
   */
  async validateAll(sources, fhirClient) {
    const results = await Promise.allSettled(
      sources.map(async (source) => {
        try {
          await fhirClient.search(source, '/metadata', {});
          this.status[source.id] = {
            status: 'UP',
            name: source.name,
            lastError: null,
            lastChecked: new Date().toISOString(),
          };
          logger.info({ sourceId: source.id, sourceName: source.name }, 'Source validation OK');
        } catch (err) {
          const isAuth =
            err.response && (err.response.status === 401 || err.response.status === 403);
          const status = isAuth ? 'AUTH_FAILED' : 'DOWN';
          const message = isAuth
            ? `Authentication failed (HTTP ${err.response.status})`
            : err.message;

          this.status[source.id] = {
            status,
            name: source.name,
            lastError: message,
            lastChecked: new Date().toISOString(),
          };
          logger.error(
            { sourceId: source.id, sourceName: source.name, error: message },
            'Source validation failed'
          );
          throw new Error(`${source.id} (${source.name}): ${message}`);
        }
      })
    );

    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);

    if (errors.length > 0) {
      const msg = `Source validation failed:\n  ${errors.join('\n  ')}`;
      throw new Error(msg);
    }
  }

  /**
   * Record a successful request to a source.
   */
  recordSuccess(sourceId) {
    if (this.status[sourceId]) {
      this.status[sourceId].status = 'UP';
      this.status[sourceId].lastError = null;
      this.status[sourceId].lastChecked = new Date().toISOString();
    }
  }

  /**
   * Record a failed request to a source.
   * Returns the failure reason for response headers.
   */
  recordFailure(sourceId, err) {
    const isAuth = err.response && (err.response.status === 401 || err.response.status === 403);
    const status = isAuth ? 'AUTH_FAILED' : 'DOWN';
    const message = isAuth ? `Authentication failed (HTTP ${err.response.status})` : err.message;

    if (this.status[sourceId]) {
      this.status[sourceId].status = status;
      this.status[sourceId].lastError = message;
      this.status[sourceId].lastChecked = new Date().toISOString();
    }

    return { sourceId, status, message };
  }

  /**
   * Get health summary for all sources.
   * Optionally includes circuit breaker state.
   */
  getHealth(circuitBreaker) {
    const cbStates = circuitBreaker ? circuitBreaker.getStates() : {};
    const sources = Object.entries(this.status).map(([id, info]) => ({
      id,
      ...info,
      ...(cbStates[id] ? { circuitBreaker: cbStates[id] } : {}),
    }));
    const allUp = sources.every((s) => s.status === 'UP');
    return {
      status: allUp ? 'UP' : 'DEGRADED',
      sources,
    };
  }
}

module.exports = SourceMonitor;
