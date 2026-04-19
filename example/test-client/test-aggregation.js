#!/usr/bin/env node

const axios = require('axios');
const chalk = require('chalk');

const AGGREGATOR_URL = process.env.AGGREGATOR_URL || 'http://localhost:3000/fhir';

class AggregatorTestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/fhir+json'
      }
    });
  }

  log(message, color = 'white') {
    console.log(chalk[color](message));
  }

  logHeader(message) {
    console.log('\n' + chalk.cyan.bold('='.repeat(60)));
    console.log(chalk.cyan.bold(`  ${message}`));
    console.log(chalk.cyan.bold('='.repeat(60)));
  }

  logSubheader(message) {
    console.log('\n' + chalk.yellow.bold(`--- ${message} ---`));
  }

  logSuccess(message) {
    console.log(chalk.green('✓ ' + message));
  }

  logError(message) {
    console.log(chalk.red('✗ ' + message));
  }

  logWarning(message) {
    console.log(chalk.yellow('⚠ ' + message));
  }

  async testMetadata() {
    this.logSubheader('Testing CapabilityStatement');

    try {
      const response = await this.client.get('/metadata');
      const capability = response.data;

      this.logSuccess(`CapabilityStatement retrieved`);
      this.log(`  Software: ${capability.software?.name || 'Unknown'}`);
      this.log(`  FHIR Version: ${capability.fhirVersion}`);
      this.log(`  Status: ${capability.status}`);
      this.log(`  Resource Types Supported: ${capability.rest?.[0]?.resource?.length || 0}`);

      return true;
    } catch (error) {
      this.logError(`Failed to get metadata: ${error.message}`);
      return false;
    }
  }

  async testHealthEndpoint() {
    this.logSubheader('Testing Health Endpoint');

    try {
      const response = await this.client.get('/health', {
        baseURL: this.baseUrl.replace('/fhir', '')
      });
      const health = response.data;

      this.logSuccess(`Health endpoint responded`);
      this.log(`  Overall Status: ${health.status}`);
      this.log(`  Sources Configured: ${health.sources?.length || 0}`);

      if (health.sources) {
        health.sources.forEach(source => {
          const status = source.status === 'UP' ? 'green' : 'red';
          this.log(`    ${source.name}: `, status);
          console.log(chalk[status](`${source.status}`));
          if (source.circuitBreaker) {
            this.log(`      Circuit Breaker: ${source.circuitBreaker.state} (failures: ${source.circuitBreaker.failures})`);
          }
        });
      }

      return true;
    } catch (error) {
      this.logError(`Failed to get health status: ${error.message}`);
      return false;
    }
  }

  async testResourceSearch(resourceType, params = {}) {
    this.logSubheader(`Testing ${resourceType} Search`);

    const queryParams = new URLSearchParams(params);
    const url = `/${resourceType}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    try {
      const response = await this.client.get(url);
      const bundle = response.data;

      this.logSuccess(`${resourceType} search completed`);
      this.log(`  Bundle Type: ${bundle.type}`);
      this.log(`  Total Results: ${bundle.total || 'unknown'}`);
      this.log(`  Entries in this page: ${bundle.entry?.length || 0}`);

      // Check for pagination
      const nextLink = bundle.link?.find(link => link.relation === 'next');
      if (nextLink) {
        this.log(`  Next Page Available: ${nextLink.url}`);
      }

      // Check for aggregation headers
      const failedSources = response.headers['x-aggregator-sources-failed'];
      const failedCount = response.headers['x-aggregator-sources-failed-count'];

      if (failedSources) {
        this.logWarning(`Some sources failed: ${failedSources} (count: ${failedCount})`);
      } else {
        this.logSuccess('All sources responded successfully');
      }

      // Show sample of results
      if (bundle.entry && bundle.entry.length > 0) {
        this.log(`  Sample results:`);
        bundle.entry.slice(0, 3).forEach((entry, index) => {
          const resource = entry.resource;
          const source = resource.meta?.source || 'Unknown';
          this.log(`    ${index + 1}. ID: ${resource.id} (Source: ${source})`);
        });
      }

      return bundle;
    } catch (error) {
      this.logError(`Failed to search ${resourceType}: ${error.message}`);
      if (error.response?.data?.issue) {
        error.response.data.issue.forEach(issue => {
          this.logError(`  ${issue.severity}: ${issue.diagnostics}`);
        });
      }
      return null;
    }
  }

  async testPagination(resourceType) {
    this.logSubheader(`Testing Pagination with ${resourceType}`);

    try {
      // Get first page with small page size
      const firstResponse = await this.client.get(`/${resourceType}?_count=5`);
      const firstBundle = firstResponse.data;

      this.logSuccess(`First page retrieved`);
      this.log(`  Entries: ${firstBundle.entry?.length || 0}`);
      this.log(`  Total: ${firstBundle.total || 'unknown'}`);

      // Check if there's a next page
      const nextLink = firstBundle.link?.find(link => link.relation === 'next');
      if (nextLink) {
        this.log(`  Next page URL: ${nextLink.url}`);

        // Extract pagination parameters
        const url = new URL(nextLink.url);
        const getpages = url.searchParams.get('_getpages');
        const offset = url.searchParams.get('_getpagesoffset');
        const count = url.searchParams.get('_count');

        this.log(`  Pagination token: ${getpages?.substring(0, 50)}...`);
        this.log(`  Offset: ${offset}, Count: ${count}`);

        // Get second page
        const secondResponse = await this.client.get(`/?_getpages=${getpages}&_getpagesoffset=${offset}&_count=${count}`);
        const secondBundle = secondResponse.data;

        this.logSuccess(`Second page retrieved`);
        this.log(`  Entries: ${secondBundle.entry?.length || 0}`);

        return { firstBundle, secondBundle };
      } else {
        this.log(`  No additional pages available`);
        return { firstBundle };
      }
    } catch (error) {
      this.logError(`Pagination test failed: ${error.message}`);
      return null;
    }
  }

  async testConcurrentRequests() {
    this.logSubheader('Testing Concurrent Request Handling');

    const requestCount = 5;
    const promises = [];

    for (let i = 0; i < requestCount; i++) {
      promises.push(this.client.get('/Patient?_count=10'));
    }

    try {
      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;

      this.logSuccess(`${requestCount} concurrent requests completed in ${duration}ms`);

      responses.forEach((response, index) => {
        const bundle = response.data;
        const failedSources = response.headers['x-aggregator-sources-failed-count'] || '0';
        this.log(`  Request ${index + 1}: ${bundle.entry?.length || 0} results, ${failedSources} failed sources`);
      });

      return true;
    } catch (error) {
      this.logError(`Concurrent requests failed: ${error.message}`);
      return false;
    }
  }

  async testResourceTypeValidation() {
    this.logSubheader('Testing Resource Type Validation');

    try {
      // Test invalid resource type
      await this.client.get('/InvalidResourceType');
      this.logError('Expected validation error for invalid resource type');
      return false;
    } catch (error) {
      if (error.response?.status === 400) {
        this.logSuccess('Invalid resource type correctly rejected with 400 status');
        return true;
      } else {
        this.logError(`Unexpected error: ${error.message}`);
        return false;
      }
    }
  }

  async testMetricsEndpoint() {
    this.logSubheader('Testing Metrics Endpoint');

    try {
      const response = await this.client.get('/metrics', {
        baseURL: this.baseUrl.replace('/fhir', ''),
        headers: { 'Accept': 'text/plain' }
      });

      const metrics = response.data;
      const lines = metrics.split('\n');
      const metricLines = lines.filter(line => line.includes('_total') || line.includes('_seconds'));

      this.logSuccess('Metrics endpoint accessible');
      this.log(`  Total metric lines: ${metricLines.length}`);

      // Show some key metrics
      const keyMetrics = [
        'http_requests_total',
        'upstream_request_duration_seconds',
        'pagination_cache_size'
      ];

      keyMetrics.forEach(metricName => {
        const metricLine = lines.find(line => line.startsWith(metricName));
        if (metricLine) {
          this.log(`  ${metricName}: found`);
        }
      });

      return true;
    } catch (error) {
      this.logError(`Failed to get metrics: ${error.message}`);
      return false;
    }
  }

  async runAllTests() {
    this.logHeader('FHIR Aggregator Functionality Test Suite');
    this.log(`Testing aggregator at: ${this.baseUrl}`);

    const results = {
      passed: 0,
      failed: 0,
      tests: []
    };

    const tests = [
      { name: 'Metadata/CapabilityStatement', fn: () => this.testMetadata() },
      { name: 'Health Endpoint', fn: () => this.testHealthEndpoint() },
      { name: 'Patient Search', fn: () => this.testResourceSearch('Patient', { _count: 20 }) },
      { name: 'Encounter Search', fn: () => this.testResourceSearch('Encounter', { _count: 15 }) },
      { name: 'Observation Search', fn: () => this.testResourceSearch('Observation', { _count: 25 }) },
      { name: 'Condition Search', fn: () => this.testResourceSearch('Condition') },
      { name: 'Pagination', fn: () => this.testPagination('Patient') },
      { name: 'Concurrent Requests', fn: () => this.testConcurrentRequests() },
      { name: 'Resource Type Validation', fn: () => this.testResourceTypeValidation() },
      { name: 'Metrics Endpoint', fn: () => this.testMetricsEndpoint() }
    ];

    for (const test of tests) {
      try {
        const result = await test.fn();
        if (result) {
          results.passed++;
          results.tests.push({ name: test.name, status: 'PASSED' });
        } else {
          results.failed++;
          results.tests.push({ name: test.name, status: 'FAILED' });
        }
      } catch (error) {
        this.logError(`Test '${test.name}' threw exception: ${error.message}`);
        results.failed++;
        results.tests.push({ name: test.name, status: 'ERROR' });
      }
    }

    // Summary
    this.logHeader('Test Results Summary');

    results.tests.forEach(test => {
      const color = test.status === 'PASSED' ? 'green' : 'red';
      this.log(`${test.status.padEnd(7)} ${test.name}`, color);
    });

    this.log(`\nTotal: ${results.passed + results.failed} tests`);
    this.log(`Passed: ${results.passed}`, 'green');
    if (results.failed > 0) {
      this.log(`Failed: ${results.failed}`, 'red');
    }

    const successRate = Math.round((results.passed / (results.passed + results.failed)) * 100);
    this.log(`Success Rate: ${successRate}%`, successRate >= 80 ? 'green' : 'yellow');

    return results;
  }
}

async function main() {
  console.log(chalk.blue.bold('🚀 FHIR Aggregator Test Client'));
  console.log(chalk.blue.bold('====================================='));

  const client = new AggregatorTestClient(AGGREGATOR_URL);

  try {
    const results = await client.runAllTests();

    if (results.failed > 0) {
      process.exit(1);
    } else {
      console.log(chalk.green.bold('\n🎉 All tests passed! The FHIR aggregator is working correctly.'));
      process.exit(0);
    }
  } catch (error) {
    console.error(chalk.red.bold('\n💥 Test suite failed with error:'), error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = AggregatorTestClient;