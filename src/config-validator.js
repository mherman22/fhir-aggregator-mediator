'use strict';

/**
 * Validates the merged configuration object on startup.
 * Throws with a clear message if any required field is missing or invalid.
 */
function validateConfig(config) {
  const errors = [];

  // app.port
  if (
    !config.app ||
    typeof config.app.port !== 'number' ||
    config.app.port < 1 ||
    config.app.port > 65535
  ) {
    errors.push('app.port must be a number between 1 and 65535');
  }

  // sources
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    errors.push('sources must be a non-empty array');
  } else {
    const ids = new Set();
    config.sources.forEach((source, i) => {
      if (!source.id || typeof source.id !== 'string') {
        errors.push(`sources[${i}].id is required and must be a string`);
      } else if (ids.has(source.id)) {
        errors.push(`sources[${i}].id "${source.id}" is duplicated`);
      } else {
        ids.add(source.id);
      }

      if (!source.name || typeof source.name !== 'string') {
        errors.push(`sources[${i}].name is required and must be a string`);
      }

      if (!source.baseUrl || typeof source.baseUrl !== 'string') {
        errors.push(`sources[${i}].baseUrl is required and must be a string`);
      } else {
        try {
          new URL(source.baseUrl);
        } catch {
          errors.push(`sources[${i}].baseUrl "${source.baseUrl}" is not a valid URL`);
        }
      }

      if (source.optional !== undefined && typeof source.optional !== 'boolean') {
        errors.push(`sources[${i}].optional must be a boolean`);
      }

      if (source.bearerToken !== undefined && typeof source.bearerToken !== 'string') {
        errors.push(`sources[${i}].bearerToken must be a string`);
      }
    });
  }

  // performance (optional, but validate if present)
  if (config.performance) {
    if (config.performance.timeoutMs !== undefined) {
      if (typeof config.performance.timeoutMs !== 'number' || config.performance.timeoutMs < 1) {
        errors.push('performance.timeoutMs must be a positive number');
      }
    }
    if (config.performance.maxSocketsPerSource !== undefined) {
      if (
        typeof config.performance.maxSocketsPerSource !== 'number' ||
        config.performance.maxSocketsPerSource < 1
      ) {
        errors.push('performance.maxSocketsPerSource must be a positive number');
      }
    }
    if (config.performance.maxConcurrentUpstreamRequests !== undefined) {
      if (
        !Number.isInteger(config.performance.maxConcurrentUpstreamRequests) ||
        config.performance.maxConcurrentUpstreamRequests < 1
      ) {
        errors.push('performance.maxConcurrentUpstreamRequests must be a positive integer');
      }
    }
    if (config.performance.requestTimeoutMs !== undefined) {
      if (
        typeof config.performance.requestTimeoutMs !== 'number' ||
        config.performance.requestTimeoutMs < 1
      ) {
        errors.push('performance.requestTimeoutMs must be a positive number');
      }
    }
  }

  // strictMode (optional boolean)
  if (config.strictMode !== undefined && typeof config.strictMode !== 'boolean') {
    errors.push('strictMode must be a boolean');
  }

  // writeTarget (optional string — must reference an existing source ID)
  if (config.writeTarget !== undefined) {
    if (typeof config.writeTarget !== 'string') {
      errors.push('writeTarget must be a string (source ID)');
    } else if (Array.isArray(config.sources) && config.sources.length > 0) {
      const ids = config.sources.map((s) => s.id);
      if (!ids.includes(config.writeTarget)) {
        errors.push(`writeTarget "${config.writeTarget}" does not match any source id`);
      }
    }
  }

  // inboundAuth (optional)
  if (config.inboundAuth !== undefined) {
    if (typeof config.inboundAuth !== 'object' || config.inboundAuth === null) {
      errors.push('inboundAuth must be an object');
    } else {
      const ia = config.inboundAuth;
      if (ia.enabled !== undefined && typeof ia.enabled !== 'boolean') {
        errors.push('inboundAuth.enabled must be a boolean');
      }
      if (ia.type !== undefined && !['basic', 'apikey'].includes(ia.type)) {
        errors.push('inboundAuth.type must be "basic" or "apikey"');
      }
      if (ia.enabled && ia.type === 'basic') {
        if (!ia.username || typeof ia.username !== 'string') {
          errors.push('inboundAuth.username is required for basic auth');
        }
        if (!ia.password || typeof ia.password !== 'string') {
          errors.push('inboundAuth.password is required for basic auth');
        }
      }
      if (ia.enabled && ia.type === 'apikey') {
        if (!ia.apiKey || typeof ia.apiKey !== 'string') {
          errors.push('inboundAuth.apiKey is required for apikey auth');
        }
      }
    }
  }

  // tls (optional)
  if (config.tls !== undefined) {
    if (typeof config.tls !== 'object' || config.tls === null) {
      errors.push('tls must be an object');
    } else {
      const tls = config.tls;
      if (tls.enabled !== undefined && typeof tls.enabled !== 'boolean') {
        errors.push('tls.enabled must be a boolean');
      }
      if (tls.enabled) {
        if (!tls.certFile || typeof tls.certFile !== 'string') {
          errors.push('tls.certFile is required when tls.enabled is true');
        }
        if (!tls.keyFile || typeof tls.keyFile !== 'string') {
          errors.push('tls.keyFile is required when tls.enabled is true');
        }
      }
    }
  }

  // pagination (optional — kept for config compatibility; stateless tokens do not use these)
  if (config.pagination) {
    if (config.pagination.cacheMaxSize !== undefined) {
      if (
        typeof config.pagination.cacheMaxSize !== 'number' ||
        config.pagination.cacheMaxSize < 1
      ) {
        errors.push('pagination.cacheMaxSize must be a positive number');
      }
    }
    if (config.pagination.cacheTtlMs !== undefined) {
      if (typeof config.pagination.cacheTtlMs !== 'number' || config.pagination.cacheTtlMs < 1) {
        errors.push('pagination.cacheTtlMs must be a positive number');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Apply environment variable overrides to the config object.
 * Supports full configuration via env vars for containerized deployments.
 */
function applyEnvOverrides(config) {
  // App port
  if (process.env.APP_PORT) {
    config.app.port = parseInt(process.env.APP_PORT, 10);
  }

  // Source credentials (including bearer token)
  config.sources.forEach((source) => {
    const envUser = process.env[`SOURCE_${source.id}_USERNAME`];
    const envPass = process.env[`SOURCE_${source.id}_PASSWORD`];
    const envUrl = process.env[`SOURCE_${source.id}_URL`];
    const envToken = process.env[`SOURCE_${source.id}_BEARER_TOKEN`];
    if (envUser !== undefined) source.username = envUser;
    if (envPass !== undefined) source.password = envPass;
    if (envUrl !== undefined) source.baseUrl = envUrl;
    if (envToken !== undefined) source.bearerToken = envToken;
  });

  // Full sources override via JSON env var
  if (process.env.SOURCES) {
    try {
      config.sources = JSON.parse(process.env.SOURCES);
    } catch (err) {
      throw new Error(`Failed to parse SOURCES environment variable as JSON: ${err.message}`);
    }
  }

  // OpenHIM mediator API credentials
  if (config.mediator && config.mediator.api) {
    const ohimUser = process.env.OPENHIM_API_USERNAME;
    const ohimPass = process.env.OPENHIM_API_PASSWORD;
    const ohimUrl = process.env.OPENHIM_API_URL;
    if (ohimUser !== undefined) config.mediator.api.username = ohimUser;
    if (ohimPass !== undefined) config.mediator.api.password = ohimPass;
    if (ohimUrl !== undefined) config.mediator.api.apiURL = ohimUrl;
  }

  // Performance settings
  if (process.env.PERFORMANCE_TIMEOUT_MS) {
    config.performance = config.performance || {};
    config.performance.timeoutMs = parseInt(process.env.PERFORMANCE_TIMEOUT_MS, 10);
  }
  if (process.env.PERFORMANCE_MAX_SOCKETS_PER_SOURCE) {
    config.performance = config.performance || {};
    config.performance.maxSocketsPerSource = parseInt(
      process.env.PERFORMANCE_MAX_SOCKETS_PER_SOURCE,
      10
    );
  }
  if (process.env.PERFORMANCE_REQUEST_TIMEOUT_MS) {
    config.performance = config.performance || {};
    config.performance.requestTimeoutMs = parseInt(process.env.PERFORMANCE_REQUEST_TIMEOUT_MS, 10);
  }
  if (process.env.PERFORMANCE_MAX_CONCURRENT_UPSTREAM_REQUESTS) {
    config.performance = config.performance || {};
    config.performance.maxConcurrentUpstreamRequests = parseInt(
      process.env.PERFORMANCE_MAX_CONCURRENT_UPSTREAM_REQUESTS,
      10
    );
  }

  // Strict mode
  if (process.env.STRICT_MODE !== undefined) {
    config.strictMode = process.env.STRICT_MODE === 'true' || process.env.STRICT_MODE === '1';
  }

  // Pagination settings
  if (process.env.PAGINATION_CACHE_MAX_SIZE) {
    config.pagination = config.pagination || {};
    config.pagination.cacheMaxSize = parseInt(process.env.PAGINATION_CACHE_MAX_SIZE, 10);
  }
  if (process.env.PAGINATION_CACHE_TTL_MS) {
    config.pagination = config.pagination || {};
    config.pagination.cacheTtlMs = parseInt(process.env.PAGINATION_CACHE_TTL_MS, 10);
  }

  // Rate limiting settings
  if (process.env.RATE_LIMIT_WINDOW_MS) {
    config.rateLimiting = config.rateLimiting || {};
    config.rateLimiting.windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10);
  }
  if (process.env.RATE_LIMIT_MAX_REQUESTS) {
    config.rateLimiting = config.rateLimiting || {};
    config.rateLimiting.maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10);
  }

  // Inbound auth settings
  if (process.env.INBOUND_AUTH_TYPE) {
    config.inboundAuth = config.inboundAuth || {};
    config.inboundAuth.enabled = true;
    config.inboundAuth.type = process.env.INBOUND_AUTH_TYPE;
  }
  if (process.env.INBOUND_AUTH_USERNAME) {
    config.inboundAuth = config.inboundAuth || {};
    config.inboundAuth.username = process.env.INBOUND_AUTH_USERNAME;
  }
  if (process.env.INBOUND_AUTH_PASSWORD) {
    config.inboundAuth = config.inboundAuth || {};
    config.inboundAuth.password = process.env.INBOUND_AUTH_PASSWORD;
  }
  if (process.env.INBOUND_AUTH_API_KEY) {
    config.inboundAuth = config.inboundAuth || {};
    config.inboundAuth.apiKey = process.env.INBOUND_AUTH_API_KEY;
  }
  if (process.env.INBOUND_AUTH_HEADER) {
    config.inboundAuth = config.inboundAuth || {};
    config.inboundAuth.header = process.env.INBOUND_AUTH_HEADER;
  }

  // TLS settings
  if (process.env.TLS_CERT_FILE) {
    config.tls = config.tls || {};
    config.tls.enabled = true;
    config.tls.certFile = process.env.TLS_CERT_FILE;
  }
  if (process.env.TLS_KEY_FILE) {
    config.tls = config.tls || {};
    config.tls.keyFile = process.env.TLS_KEY_FILE;
  }
  if (process.env.TLS_PASSPHRASE) {
    config.tls = config.tls || {};
    config.tls.passphrase = process.env.TLS_PASSPHRASE;
  }

  // Write target
  if (process.env.WRITE_TARGET) {
    config.writeTarget = process.env.WRITE_TARGET;
  }

  return config;
}

module.exports = { validateConfig, applyEnvOverrides };
