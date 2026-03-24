'use strict';

const axios = require('axios');
const http = require('http');
const https = require('https');

class FhirClient {
  constructor(config = {}) {
    this.timeout = config.timeout || 30000;

    // Connection pooling — reuse TCP connections across requests
    // Prevents creating/destroying thousands of connections during a pipeline run
    const maxSockets = config.maxSocketsPerSource || 5;
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets,
      maxFreeSockets: Math.ceil(maxSockets / 2),
      timeout: this.timeout,
    });
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets,
      maxFreeSockets: Math.ceil(maxSockets / 2),
      timeout: this.timeout,
      rejectUnauthorized: false,
    });
  }

  async search(source, path, queryParams) {
    const url = `${source.baseUrl}${path}`;
    const response = await axios.get(url, {
      params: queryParams,
      auth: source.username ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
      headers: { Accept: 'application/fhir+json' },
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  async fetchUrl(source, absoluteUrl) {
    const response = await axios.get(absoluteUrl, {
      auth: source.username ? { username: source.username, password: source.password } : undefined,
      timeout: this.timeout,
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
