# Load Testing Guide

## Prerequisites

Install [k6](https://k6.io/docs/getting-started/installation/):

```bash
# macOS
brew install k6

# Docker
docker pull grafana/k6
```

## Running Load Tests

### Against a local instance

```bash
# Start the mediator
npm start

# Run the load test
k6 run load-tests/k6-load-test.js

# With custom base URL
k6 run -e BASE_URL=http://localhost:3000 load-tests/k6-load-test.js
```

### With Docker

```bash
docker run --rm -i --network=host grafana/k6 run - < load-tests/k6-load-test.js
```

## SLOs

| Metric | Target |
|--------|--------|
| p95 latency | < 2 seconds |
| p99 latency | < 5 seconds |
| Error rate | < 1% |

## Test Scenarios

1. **Steady state** — 10 concurrent users for 2 minutes
2. **Burst** — Ramp up to 50 users over 10s, sustain for 30s, ramp down
