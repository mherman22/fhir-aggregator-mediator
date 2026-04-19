'use strict';

const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const http = require('http');
const https = require('https');
const logger = require('./logger');

function hasAuth(source) {
  return typeof source.username === 'string' && source.username.length > 0;
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
      auth: hasAuth(source) ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json', ...extraHeaders },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  async fetchUrl(source, absoluteUrl, extraHeaders = {}) {
    const response = await this.client.get(absoluteUrl, {
      auth: hasAuth(source) ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json', ...extraHeaders },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  destroy() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

module.exports = FhirClient;
