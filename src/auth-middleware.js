'use strict';

const crypto = require('crypto');

/**
 * Inbound authentication middleware.
 *
 * Supports two modes, configured via config.inboundAuth or environment variables:
 *
 *   basic  — HTTP Basic Auth: validates username + password in the Authorization header.
 *   apikey — Static API key: validates a key supplied in a request header (default: X-API-Key).
 *
 * Relevant environment variables:
 *   INBOUND_AUTH_TYPE       basic | apikey
 *   INBOUND_AUTH_USERNAME   username (basic mode)
 *   INBOUND_AUTH_PASSWORD   password (basic mode)
 *   INBOUND_AUTH_API_KEY    expected key (apikey mode)
 *   INBOUND_AUTH_HEADER     header name (apikey mode; default: X-API-Key)
 *
 * Health, readiness, and metrics endpoints are always exempt from auth checks.
 */

// Paths that are never protected — used for liveness/readiness/scraping.
const EXEMPT_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Parse an HTTP Basic Auth header.
 * Returns { username, password } or null.
 */
function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Constant-time string equality to prevent timing attacks.
 * Returns true only when both strings are identical.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform a dummy compare against a same-length copy of bufA so that the
    // timing of this branch does not leak the length of the expected secret.
    crypto.timingSafeEqual(bufA, Buffer.allocUnsafe(bufA.length).fill(bufA));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function unauthorizedResponse(res) {
  return res
    .status(401)
    .set('Content-Type', 'application/fhir+json; charset=utf-8')
    .json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'security', diagnostics: 'Unauthorized' }],
    });
}

/**
 * Create an Express middleware that enforces inbound authentication.
 *
 * @param {Object} authConfig
 * @param {string} authConfig.type       - 'basic' | 'apikey'
 * @param {string} [authConfig.username] - required for type='basic'
 * @param {string} [authConfig.password] - required for type='basic'
 * @param {string} [authConfig.apiKey]   - required for type='apikey'
 * @param {string} [authConfig.header]   - header name for type='apikey' (default: 'X-API-Key')
 */
function createAuthMiddleware(authConfig) {
  const { type, username = '', password = '', apiKey = '', header = 'X-API-Key' } = authConfig;

  return function inboundAuthMiddleware(req, res, next) {
    // Exempt health/readiness/metrics endpoints from auth
    if (EXEMPT_PATHS.has(req.path)) return next();

    if (type === 'basic') {
      const creds = parseBasicAuth(req.headers.authorization);
      if (creds && safeEqual(creds.username, username) && safeEqual(creds.password, password)) {
        return next();
      }
      res.set('WWW-Authenticate', 'Basic realm="FHIR Aggregator"');
      return unauthorizedResponse(res);
    }

    if (type === 'apikey') {
      const provided = req.headers[header.toLowerCase()];
      if (provided && safeEqual(provided, apiKey)) {
        return next();
      }
      return unauthorizedResponse(res);
    }

    // Unknown or unconfigured type — fail closed
    return unauthorizedResponse(res);
  };
}

module.exports = { createAuthMiddleware };
