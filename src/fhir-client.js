'use strict';

const axios = require('axios');

class FhirClient {
  constructor(timeout = 30000) {
    this.timeout = timeout;
  }

  async search(source, path, queryParams) {
    const url = `${source.baseUrl}${path}`;
    const response = await axios.get(url, {
      params: queryParams,
      auth: { username: source.username, password: source.password },
      timeout: this.timeout,
      headers: { Accept: 'application/fhir+json' },
    });
    return response.data;
  }

  async fetchUrl(source, absoluteUrl) {
    const response = await axios.get(absoluteUrl, {
      auth: { username: source.username, password: source.password },
      timeout: this.timeout,
      headers: { Accept: 'application/fhir+json' },
    });
    return response.data;
  }
}

module.exports = FhirClient;
