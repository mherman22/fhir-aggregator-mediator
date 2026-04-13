'use strict';

const logger = require('./logger');

/**
 * Simple per-source circuit breaker.
 *
 * States:
 *   CLOSED   — normal, requests pass through
 *   OPEN     — source is considered down, requests are skipped
 *   HALF_OPEN — one probe request is allowed through to check recovery
 */
class CircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold || 5;
    this.resetTimeoutMs = config.resetTimeoutMs || 30000;
    // { sourceId: { state, failures, lastFailure, lastStateChange } }
    this.circuits = {};
  }

  _getCircuit(sourceId) {
    if (!this.circuits[sourceId]) {
      this.circuits[sourceId] = {
        state: 'CLOSED',
        failures: 0,
        lastFailure: null,
        lastStateChange: Date.now(),
      };
    }
    return this.circuits[sourceId];
  }

  /**
   * Check whether a request to this source should be allowed.
   * Returns true if the circuit is CLOSED or HALF_OPEN (probe).
   */
  allowRequest(sourceId) {
    const circuit = this._getCircuit(sourceId);

    if (circuit.state === 'CLOSED') {
      return true;
    }

    if (circuit.state === 'OPEN') {
      // Check if enough time has passed to transition to HALF_OPEN
      const elapsed = Date.now() - circuit.lastFailure;
      if (elapsed >= this.resetTimeoutMs) {
        circuit.state = 'HALF_OPEN';
        circuit.lastStateChange = Date.now();
        logger.info(
          { sourceId, from: 'OPEN', to: 'HALF_OPEN' },
          'Circuit breaker state transition'
        );
        return true; // allow a probe request
      }
      return false;
    }

    // HALF_OPEN — allow the probe request
    return true;
  }

  /**
   * Record a successful request — reset the circuit to CLOSED.
   */
  recordSuccess(sourceId) {
    const circuit = this._getCircuit(sourceId);
    if (circuit.state !== 'CLOSED') {
      logger.info(
        { sourceId, from: circuit.state, to: 'CLOSED' },
        'Circuit breaker state transition'
      );
    }
    circuit.state = 'CLOSED';
    circuit.failures = 0;
    circuit.lastStateChange = Date.now();
  }

  /**
   * Record a failed request. If failures exceed the threshold, open the circuit.
   */
  recordFailure(sourceId) {
    const circuit = this._getCircuit(sourceId);
    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.state === 'HALF_OPEN') {
      // Probe failed — re-open
      circuit.state = 'OPEN';
      circuit.lastStateChange = Date.now();
      logger.warn(
        { sourceId, from: 'HALF_OPEN', to: 'OPEN' },
        'Circuit breaker state transition (probe failed)'
      );
    } else if (circuit.failures >= this.failureThreshold) {
      const prevState = circuit.state;
      circuit.state = 'OPEN';
      circuit.lastStateChange = Date.now();
      if (prevState !== 'OPEN') {
        logger.warn(
          { sourceId, from: prevState, to: 'OPEN', failures: circuit.failures },
          'Circuit breaker state transition (threshold reached)'
        );
      }
    }
  }

  /**
   * Get the current state of all circuits for health/metrics.
   */
  getStates() {
    const states = {};
    for (const [id, circuit] of Object.entries(this.circuits)) {
      states[id] = {
        state: circuit.state,
        failures: circuit.failures,
        lastFailure: circuit.lastFailure ? new Date(circuit.lastFailure).toISOString() : null,
      };
    }
    return states;
  }
}

module.exports = CircuitBreaker;
