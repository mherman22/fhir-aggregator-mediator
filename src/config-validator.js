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
  }

  // pagination (optional)
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

  // Source credentials
  config.sources.forEach((source) => {
    const envUser = process.env[`SOURCE_${source.id}_USERNAME`];
    const envPass = process.env[`SOURCE_${source.id}_PASSWORD`];
    const envUrl = process.env[`SOURCE_${source.id}_URL`];
    if (envUser !== undefined) source.username = envUser;
    if (envPass !== undefined) source.password = envPass;
    if (envUrl !== undefined) source.baseUrl = envUrl;
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

  return config;
}

module.exports = { validateConfig, applyEnvOverrides };
