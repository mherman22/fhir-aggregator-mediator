'use strict';

const axios = require('axios');
const http = require('http');
const https = require('https');

function hasAuth(source) {
  return typeof source.username === 'string' && source.username.length > 0;
}

class FhirClient {
  constructor(config = {}) {
    this.timeout = config.timeout || 30000;
    this.maxContentLength = config.maxContentLength || 50 * 1024 * 1024; // 50 MB
    this.maxRedirects = config.maxRedirects != null ? config.maxRedirects : 5;

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
  }

  async search(source, path, queryParams) {
    const url = `${source.baseUrl}${path}`;
    const response = await axios.get(url, {
      params: queryParams,
      auth: hasAuth(source) ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json' },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  async fetchUrl(source, absoluteUrl) {
    const response = await axios.get(absoluteUrl, {
      auth: hasAuth(source) ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
      maxContentLength: this.maxContentLength,
      maxBodyLength: this.maxContentLength,
      maxRedirects: this.maxRedirects,
      headers: { Accept: 'application/fhir+json' },
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
