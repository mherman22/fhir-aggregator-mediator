import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const searchDuration = new Trend('search_duration', true);

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RESOURCE_TYPES = ['Patient', 'Encounter', 'Observation', 'Condition', 'Location'];

// Test scenarios
export const options = {
  scenarios: {
    // Steady-state load
    steady_state: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      tags: { scenario: 'steady_state' },
    },
    // Burst test
    burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      startTime: '2m30s',
      tags: { scenario: 'burst' },
    },
  },
  thresholds: {
    // SLOs
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // Random resource type
  const resourceType = RESOURCE_TYPES[Math.floor(Math.random() * RESOURCE_TYPES.length)];

  const res = http.get(`${BASE_URL}/fhir/${resourceType}?_count=20`, {
    headers: { Accept: 'application/fhir+json' },
    tags: { resource_type: resourceType },
  });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response is Bundle': (r) => {
      try {
        return JSON.parse(r.body).resourceType === 'Bundle';
      } catch {
        return false;
      }
    },
    'response time < 2s': (r) => r.timings.duration < 2000,
  });

  errorRate.add(!success);
  searchDuration.add(res.timings.duration);

  sleep(0.5 + Math.random());
}

// Health check before test
export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health check passed': (r) => r.status === 200,
  });
}
