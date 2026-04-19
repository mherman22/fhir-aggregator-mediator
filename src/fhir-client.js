'use strict';

const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const http = require('http');
const https = require('https');
const logger = require('./logger');

function hasBasicAuth(source) {
  return typeof source.username === 'string' && source.username.length > 0;
}

function hasBearerToken(source) {
  return typeof source.bearerToken === 'string' && source.bearerToken.length > 0;
}

/**
 * Build the axios `auth` object for Basic Auth, or null when using Bearer or no auth.
 */
function getBasicAuth(source) {
  if (hasBearerToken(source)) return undefined; // Bearer token takes precedence
  if (hasBasicAuth(source)) return { username: source.username, password: source.password };
  return undefined;
}

/**
 * Return any extra auth headers needed (Bearer token).
 * Returns an empty object when Basic Auth or no auth is used.
 */
function getAuthHeaders(source) {
  if (hasBearerToken(source)) {
    return { Authorization: `Bearer ${source.bearerToken}` };
  }
  return {};
}

class FhirClient {
  constructor(config = {}) {
    // Support both `timeoutMs` (config.json key) and legacy `timeout` spelling
    this.timeout = config.timeoutMs || config.timeout || 30000;
    this.maxContentLength = config.maxContentLength || 50 * 1024 * 1024; // 50 MB
    this.maxRedirects = config.maxRedirects !== undefined ? config.maxRedirects : 5;

    // Retry configuration (Issue 5)
    this.maxRetries = config.maxRetries !== undefined ? config.maxRetries : 3;
    this.initialDelayMs = config.initialDelayMs || 500;
    this.maxDelayMs = config.maxDelayMs || 5000;

    // Connection pooling — reuse TCP connections across requests
    // Prevents creating/destroying thousands of connections during a pipeline run
    const maxSockets = config.maxSocketsPerSource || 5;
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets,
      maxFreeSockets: Math.ceil(maxSockets / 2),
      timeout: this.timeout,
    });

    // TLS verification is on by default; set rejectUnauthorized: false only when
    // the caller explicitly opts in (e.g. for self-signed certs in dev/test).
    const rejectUnauthorized = config.rejectUnauthorized !== false;
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets,
      maxFreeSockets: Math.ceil(maxSockets / 2),
      timeout: this.timeout,
      rejectUnauthorized,
    });

    // Create an axios instance with retry support
    this.client = axios.create();
    axiosRetry(this.client, {
      retries: this.maxRetries,
      retryDelay: (retryCount) => {
        // Exponential backoff with jitter
        const delay = Math.min(this.initialDelayMs * Math.pow(2, retryCount - 1), this.maxDelayMs);
        const jitter = delay * 0.2 * Math.random();
        return delay + jitter;
      },
      retryCondition: (error) => {
        // Retry on network errors and 5xx server errors (not 4xx client errors)
        if (!error.response) return true; // network error
        const status = error.response.status;
        return status === 502 || status === 503 || status === 504;
      },
      onRetry: (retryCount, error, requestConfig) => {
        logger.warn(
          {
            attempt: retryCount,
            maxRetries: this.maxRetries,
            url: requestConfig.url,
            error: error.message,
          },
          'Retrying upstream request'
        );
      },
    });
  }

  async search(source, path, queryParams, extraHeaders = {}) {
    const url = `${source.baseUrl}${path}`;
    const response = await this.client.get(url, {
      params: queryParams,
      auth: getBasicAuth(source),
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json', ...getAuthHeaders(source), ...extraHeaders },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  async fetchUrl(source, absoluteUrl, extraHeaders = {}) {
    const response = await this.client.get(absoluteUrl, {
      auth: getBasicAuth(source),
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json', ...getAuthHeaders(source), ...extraHeaders },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  /**
   * Proxy a write operation (POST / PUT / PATCH / DELETE) to an upstream source.
   *
   * @param {Object}  source  - source config object
   * @param {string}  method  - HTTP method (POST, PUT, PATCH, DELETE)
   * @param {string}  path    - resource path, e.g. '/Patient/123'
   * @param {Object|null} body - request body (ignored for DELETE)
   * @param {Object}  extraHeaders
   * @returns {{ status: number, data: any, headers: Object }}
   */
  async write(source, method, path, body, extraHeaders = {}) {
    const url = `${source.baseUrl}${path}`;
    const response = await this.client.request({
      method: method.toLowerCase(),
      url,
      data: body !== undefined ? body : undefined,
      auth: getBasicAuth(source),
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: {
        Accept: 'application/fhir+json',
        'Content-Type': 'application/fhir+json; charset=utf-8',
        ...getAuthHeaders(source),
        ...extraHeaders,
      },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return { status: response.status, data: response.data, headers: response.headers };
  }

  destroy() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

module.exports = FhirClient;
