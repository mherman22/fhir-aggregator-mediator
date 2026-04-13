#!/usr/bin/env bash
#
# create-issues.sh — Create all 14 production-readiness GitHub issues
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Run from the repository root
#
# Usage:
#   chmod +x create-issues.sh
#   ./create-issues.sh
#

set -euo pipefail

REPO="mherman22/fhir-aggregator-mediator"
LABELS_CREATED=false

# Create labels if they don't exist (idempotent)
create_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  gh label create "$name" --color "$color" --description "$description" --repo "$REPO" 2>/dev/null || true
}

echo "==> Ensuring labels exist..."
create_label "production-readiness" "0E8A16" "Issues related to production readiness"
create_label "scalability" "1D76DB" "Issues related to horizontal/vertical scaling"
create_label "observability" "D93F0B" "Issues related to logging, metrics, tracing"
create_label "resilience" "FBCA04" "Issues related to fault tolerance and reliability"
create_label "performance" "5319E7" "Issues related to performance optimization"
create_label "operations" "006B75" "Issues related to deployment and operations"
create_label "deployment" "0075CA" "Issues related to deployment infrastructure"
create_label "maintenance" "BFD4F2" "Issues related to maintenance and upgrades"
create_label "testing" "F9D0C4" "Issues related to testing"

echo ""
echo "==> Creating 14 production-readiness issues..."
echo ""

# ─── Issue 1 ───────────────────────────────────────────────────────────────────
echo "Creating issue 1/14: Clustering / Horizontal Scaling..."
gh issue create --repo "$REPO" \
  --title "Add clustering / horizontal scaling support" \
  --label "enhancement,production-readiness,scalability" \
  --body '## Problem

The mediator currently runs as a single Node.js process (`node src/index.js`), which means it can only use one CPU core. Under high request volumes, the single event loop becomes a bottleneck — especially during CPU-intensive deduplication of large result sets in `aggregator.js` or when fanning out to many upstream FHIR servers.

## Current State

- `src/index.js` starts a single Express server on one process
- `Dockerfile` runs `CMD ["node", "src/index.js"]` — single process
- `docker-compose.yml` defines one replica with 0.5 CPU limit

## Proposed Solution

- Add Node.js `cluster` module support to fork worker processes equal to available CPU cores
- Each worker runs its own Express server sharing the same port
- The master process handles worker lifecycle (restart on crash, graceful shutdown propagation)
- Alternatively, document how to run multiple container replicas behind a load balancer
- Consider the implications for the in-process LRU pagination cache (tokens created on one worker won'"'"'t be found on another)

## Acceptance Criteria

- [ ] Mediator can utilize multiple CPU cores
- [ ] Worker crash is automatically recovered
- [ ] Graceful shutdown propagates to all workers
- [ ] Documentation updated with scaling guidance'

# ─── Issue 2 ───────────────────────────────────────────────────────────────────
echo "Creating issue 2/14: Structured Logging..."
gh issue create --repo "$REPO" \
  --title "Replace console logging with structured JSON logger" \
  --label "enhancement,production-readiness,observability" \
  --body '## Problem

The mediator uses raw `console.log()` and `console.error()` throughout all source files. These log lines lack timestamps, log levels, request correlation IDs, and structured fields — making them unusable with log aggregation systems (ELK, Grafana Loki, Splunk, CloudWatch).

## Current State

- `src/aggregator.js:3` — `const logger = console;`
- `src/index.js` — uses `console.log`, `console.warn`, `console.error` directly
- `src/routes.js:327` — logs request metrics as unstructured string: `[routes] Patient: 42 entries, total=42, 1234ms`
- `src/source-monitor.js` — uses `console.log` and `console.error`
- No request correlation IDs — impossible to trace a single request across log lines

## Proposed Solution

- Replace `console` with a structured JSON logger like `pino` (fastest for Node.js) or `winston`
- Generate a UUID correlation ID per incoming request via middleware, pass it through to upstream calls
- Log in JSON format with fields: `level`, `timestamp`, `correlationId`, `sourceId`, `resourceType`, `responseTimeMs`, `statusCode`, `message`
- Use log levels consistently: `info` for normal operations, `warn` for degraded sources, `error` for failures, `debug` for verbose tracing
- Support configurable log level via environment variable (e.g., `LOG_LEVEL=info`)

## Acceptance Criteria

- [ ] All log output is structured JSON
- [ ] Every request gets a unique correlation ID visible in logs
- [ ] Log level is configurable via environment variable
- [ ] Existing tests still pass
- [ ] README documents logging configuration'

# ─── Issue 3 ───────────────────────────────────────────────────────────────────
echo "Creating issue 3/14: Prometheus Metrics..."
gh issue create --repo "$REPO" \
  --title "Add Prometheus metrics and observability endpoint" \
  --label "enhancement,production-readiness,observability" \
  --body '## Problem

There is currently no way to monitor the mediator'"'"'s throughput, latency percentiles, error rates, or upstream health in real time. The `/health` endpoint provides basic UP/DOWN status but no quantitative metrics. Production deployments need Prometheus-compatible metrics for dashboards and alerting.

## Current State

- `/health` endpoint in `src/index.js:56-60` returns per-source UP/DOWN/AUTH_FAILED status
- Request timing is logged as a string in `src/routes.js:326-329` but not exposed as a metric
- No `/metrics` endpoint exists
- No integration with any metrics library

## Proposed Solution

Add `prom-client` library to expose a `/metrics` endpoint in Prometheus exposition format with these metrics:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Inbound request latency |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total inbound requests |
| `upstream_request_duration_seconds` | Histogram | `source_id`, `resource_type` | Per-source upstream latency |
| `upstream_errors_total` | Counter | `source_id`, `error_type` | Per-source error count |
| `active_requests` | Gauge | — | Currently in-flight requests |
| `pagination_cache_size` | Gauge | — | Current LRU cache entries |
| `pagination_cache_hits_total` | Counter | — | Cache hits |
| `pagination_cache_misses_total` | Counter | — | Cache misses |
| `dedup_removed_total` | Counter | — | Duplicates removed |

Consider adding OpenTelemetry tracing for distributed tracing of fan-out requests.

## Acceptance Criteria

- [ ] `/metrics` endpoint returns Prometheus-compatible metrics
- [ ] All key metrics listed above are implemented
- [ ] Metrics are accurate under concurrent load
- [ ] Documentation includes Prometheus scrape configuration example
- [ ] Optional: Grafana dashboard JSON provided'

# ─── Issue 4 ───────────────────────────────────────────────────────────────────
echo "Creating issue 4/14: Circuit Breaker..."
gh issue create --repo "$REPO" \
  --title "Implement circuit breaker pattern for upstream sources" \
  --label "enhancement,production-readiness,resilience" \
  --body '## Problem

When an upstream FHIR server is down or slow, every incoming request still attempts to call it. This adds unnecessary latency to every aggregated response and wastes resources. The `SourceMonitor` class tracks per-source health status but does not prevent calls to known-down sources.

## Current State

- `src/aggregator.js:35-47` — `searchAll()` fans out to ALL sources on every request via `Promise.all()`
- `src/source-monitor.js:60-84` — records success/failure per source but doesn'"'"'t gate future calls
- A single slow/down source adds its full timeout (30s default) to every request'"'"'s latency
- With 4 sources, one down source means every request takes ≥30s instead of returning partial results quickly

## Proposed Solution

- Implement a circuit breaker per upstream source (e.g., using `opossum` library or custom implementation)
- Circuit states: **CLOSED** (normal) → **OPEN** (after N consecutive failures, skip source) → **HALF-OPEN** (periodic probe to check recovery)
- When a circuit is OPEN, immediately skip that source — no request sent, no timeout waited
- Configurable thresholds: `failureThreshold` (e.g., 5), `resetTimeoutMs` (e.g., 30000)
- Integrate circuit state into `/health` endpoint response
- Log circuit state transitions (CLOSED→OPEN, OPEN→HALF-OPEN, HALF-OPEN→CLOSED)

## Acceptance Criteria

- [ ] Circuit breaker prevents calls to known-down sources
- [ ] Circuit automatically recovers when source comes back online
- [ ] Thresholds are configurable via config.json
- [ ] `/health` endpoint shows circuit breaker state per source
- [ ] Response latency is not impacted by down sources (after circuit opens)
- [ ] Existing tests pass; new tests cover circuit breaker behavior'

# ─── Issue 5 ───────────────────────────────────────────────────────────────────
echo "Creating issue 5/14: Retry with Backoff..."
gh issue create --repo "$REPO" \
  --title "Add retry with exponential backoff for transient upstream failures" \
  --label "enhancement,production-readiness,resilience" \
  --body '## Problem

Upstream FHIR server requests in `FhirClient` have no retry logic. A single transient failure (network blip, 503 Service Unavailable, ECONNRESET) causes the entire source to be reported as failed for that request. This leads to unnecessary data loss in aggregated results.

## Current State

- `src/fhir-client.js:39-52` — `search()` makes a single axios call; any error propagates immediately
- `src/fhir-client.js:55-67` — `fetchUrl()` same behavior for pagination fetches
- `src/aggregator.js:42-46` — errors are caught and source is marked as failed for the entire request
- No distinction between transient errors (retryable) and permanent errors (not retryable)

## Proposed Solution

- Add configurable retry logic with exponential backoff for transient errors
- **Retryable errors:** HTTP 502, 503, 504, ECONNRESET, ETIMEDOUT, ECONNREFUSED
- **Non-retryable errors:** HTTP 400, 401, 403, 404 (client errors)
- Configuration: `maxRetries` (default: 3), `initialDelayMs` (default: 500), `maxDelayMs` (default: 5000)
- Options: use `axios-retry` library or implement manually
- Add jitter to backoff delay to avoid thundering herd on upstream recovery
- Log each retry attempt with attempt number and delay

## Acceptance Criteria

- [ ] Transient upstream errors are retried automatically
- [ ] Client errors (4xx) are NOT retried
- [ ] Retry count, delay, and max delay are configurable
- [ ] Jitter is applied to prevent thundering herd
- [ ] Retries are logged at `warn` level
- [ ] Existing tests pass; new tests cover retry behavior'

# ─── Issue 6 ───────────────────────────────────────────────────────────────────
echo "Creating issue 6/14: Rate Limiting..."
gh issue create --repo "$REPO" \
  --title "Add rate limiting and concurrency controls" \
  --label "enhancement,production-readiness,resilience" \
  --body '## Problem

There is no protection against request floods. Each incoming request fans out to N upstream FHIR servers, meaning a burst of 100 concurrent requests generates 400 upstream requests (with 4 sources). This can overwhelm upstream servers and exhaust Node.js memory/connections.

## Current State

- No inbound rate limiting — any client can send unlimited requests
- No concurrency limiting — all fan-out requests execute simultaneously
- `src/fhir-client.js:19` — `maxSockets` is limited to 5 per source (TCP-level only)
- No backpressure mechanism when upstreams are slow
- `docker-compose.yml` limits memory to 512M but no request-level protection

## Proposed Solution

1. **Inbound rate limiting** — add `express-rate-limit` middleware
   - Configurable: requests per window, window size, per-IP or global
   - Return `429 Too Many Requests` with FHIR OperationOutcome when exceeded
   - Include `Retry-After` header

2. **Concurrency limiting** — cap the number of in-flight upstream requests
   - Use a semaphore/queue pattern to prevent overwhelming upstreams
   - Configurable: `maxConcurrentUpstreamRequests` (e.g., 50)

3. **Metrics** — expose rate limit metrics (ties into Prometheus metrics issue)

## Acceptance Criteria

- [ ] Inbound rate limiting prevents request floods
- [ ] 429 responses include proper FHIR OperationOutcome and Retry-After header
- [ ] Concurrent upstream requests are bounded
- [ ] Rate limits are configurable via config.json / environment variables
- [ ] Rate limit metrics are exposed
- [ ] Existing tests pass; new tests cover rate limiting'

# ─── Issue 7 ───────────────────────────────────────────────────────────────────
echo "Creating issue 7/14: Security Hardening..."
gh issue create --repo "$REPO" \
  --title "Security hardening: HTTP headers, non-root container, body limits" \
  --label "enhancement,production-readiness,security" \
  --body '## Problem

The mediator lacks standard HTTP security headers, runs as root in the Docker container, and has no request body size limits. These are baseline security requirements for any production-facing HTTP service.

## Current State

- No HTTP security headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.)
- `Dockerfile:1` — `FROM node:18-alpine` runs as root by default (no `USER` directive)
- No request body size limits configured in Express
- No CORS configuration
- No `--max-old-space-size` Node.js flag to prevent OOM crashes
- Credentials stored in `config/config.json` in plaintext (mitigated partially by env var overrides in `src/index.js:15-20`)

## Proposed Solution

1. Add `helmet` middleware for HTTP security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security, etc.)
2. Add `USER node` directive in Dockerfile to run as non-root
3. Add `express.json({ limit: '"'"'1mb'"'"' })` middleware for body size limits
4. Add `--max-old-space-size=384` to Node.js CMD in Dockerfile (within 512M container limit)
5. Configure CORS if the mediator may be accessed from browser-based clients
6. Ensure all credential env var overrides are documented
7. Add `.dockerignore` if not present to prevent leaking secrets into image

## Acceptance Criteria

- [ ] Security headers present on all responses (verify with `curl -I`)
- [ ] Docker container runs as non-root user
- [ ] Request body size is limited
- [ ] Node.js heap size is bounded to prevent container OOM
- [ ] Security scan (e.g., `npm audit`, `trivy`) shows no critical vulnerabilities
- [ ] README documents security configuration'

# ─── Issue 8 ───────────────────────────────────────────────────────────────────
echo "Creating issue 8/14: Response Compression..."
gh issue create --repo "$REPO" \
  --title "Add response compression (gzip/deflate)" \
  --label "enhancement,production-readiness,performance" \
  --body '## Problem

FHIR Bundle responses can be very large (thousands of entries with verbose JSON). Currently, all responses are sent uncompressed, wasting bandwidth and increasing response times — especially for clients on slow networks or in bandwidth-constrained environments.

## Current State

- `src/routes.js:197-198` — `fhirJson()` sends JSON responses with no compression
- No `compression` middleware configured in `src/index.js`
- Typical FHIR JSON compresses 70-80% with gzip

## Proposed Solution

- Add `compression` middleware (npm `compression` package) to Express in `src/index.js`
- Configure minimum response size threshold (e.g., 1KB) to avoid compressing tiny responses
- Ensure `Content-Encoding` header is set correctly
- Make compression configurable (enable/disable via config) for environments where a reverse proxy handles compression

## Acceptance Criteria

- [ ] Responses are gzip-compressed when client sends `Accept-Encoding: gzip`
- [ ] Small responses below threshold are not compressed
- [ ] Compression is configurable (can be disabled)
- [ ] No impact on response correctness (clients can parse compressed responses)
- [ ] Bandwidth reduction verified with sample large bundle'

# ─── Issue 9 ───────────────────────────────────────────────────────────────────
echo "Creating issue 9/14: Configuration Management..."
gh issue create --repo "$REPO" \
  --title "Improve configuration management: full env var support and validation" \
  --label "enhancement,production-readiness,operations" \
  --body '## Problem

Configuration is primarily managed through a static JSON file (`config/config.json`). Only credentials and the OpenHIM API URL support environment variable overrides. Adding or modifying sources requires editing the JSON file and redeploying — a significant operational burden in production.

## Current State

- `config/config.json` — static file with all configuration
- `src/index.js:15-20` — env var overrides only for `SOURCE_{id}_USERNAME` and `SOURCE_{id}_PASSWORD`
- `src/index.js:23-30` — env var overrides only for `OPENHIM_API_USERNAME`, `OPENHIM_API_PASSWORD`, `OPENHIM_API_URL`
- No env var support for: app port, source URLs, pagination settings, performance settings
- No configuration validation on startup (e.g., missing source URL would cause a runtime error)
- No way to reload configuration without restart

## Proposed Solution

1. **Full env var support:**
   - `APP_PORT` for server port
   - `SOURCES` as JSON string env var for complete source list
   - OR individual `SOURCE_1_URL`, `SOURCE_1_ID`, `SOURCE_1_NAME` patterns
   - `PAGINATION_CACHE_MAX_SIZE`, `PAGINATION_CACHE_TTL_MS`
   - `PERFORMANCE_TIMEOUT_MS`, `PERFORMANCE_MAX_SOCKETS_PER_SOURCE`

2. **Startup validation:**
   - Validate required fields (source URLs, IDs)
   - Validate URL formats
   - Validate numeric ranges (port 1-65535, timeouts > 0)
   - Fail fast with clear error messages for invalid config

3. **Documentation:**
   - Complete configuration reference table with all options, defaults, and env var names

4. **Optional:** Support config reload via SIGHUP signal or admin endpoint

## Acceptance Criteria

- [ ] All config values can be overridden via environment variables
- [ ] Invalid configuration is caught at startup with clear error messages
- [ ] README includes a complete configuration reference table
- [ ] Docker/Kubernetes deployment can be fully configured without mounting config files
- [ ] Existing tests pass'

# ─── Issue 10 ──────────────────────────────────────────────────────────────────
echo "Creating issue 10/14: Kubernetes Readiness..."
gh issue create --repo "$REPO" \
  --title "Add Kubernetes / container orchestration readiness" \
  --label "enhancement,production-readiness,deployment" \
  --body '## Problem

The mediator only has Docker Compose manifests. For production deployments, Kubernetes is the standard orchestration platform. The mediator also lacks a dedicated readiness probe — the `/health` endpoint serves both liveness and readiness checks, which have different semantics in Kubernetes.

## Current State

- `docker-compose.yml` — basic Docker Swarm deployment with resource limits
- `Dockerfile:15-16` — single `HEALTHCHECK` used for both liveness and readiness
- `/health` endpoint (`src/index.js:56-60`) returns 503 when any source is DEGRADED
- No `/ready` endpoint — during the 15-minute startup validation loop, the container is not ready but no readiness endpoint exists
- No Kubernetes manifests, Helm chart, or HPA configuration

## Proposed Solution

1. **Add `/ready` endpoint:**
   - Returns 503 during startup (while sources are being validated)
   - Returns 200 once all sources pass initial validation
   - Distinct from `/health` (liveness) which can return 200 even during degraded operation

2. **Create Kubernetes manifests or Helm chart:**
   - `Deployment` with configurable replicas
   - `Service` (ClusterIP)
   - Liveness probe → `/health`
   - Readiness probe → `/ready`
   - `HorizontalPodAutoscaler` (HPA) based on CPU/custom metrics
   - `PodDisruptionBudget` (PDB) for zero-downtime rolling updates
   - `ConfigMap` and `Secret` for configuration

3. **Align shutdown timing:**
   - Set `terminationGracePeriodSeconds` to match the graceful shutdown timeout in `src/index.js:127-128`

## Acceptance Criteria

- [ ] `/ready` endpoint correctly reflects startup state
- [ ] Kubernetes manifests or Helm chart provided
- [ ] HPA scales based on CPU (and optionally custom metrics)
- [ ] Rolling updates don'"'"'t cause downtime (PDB configured)
- [ ] Graceful shutdown works correctly in Kubernetes (SIGTERM handling)
- [ ] Documentation includes Kubernetes deployment guide'

# ─── Issue 11 ──────────────────────────────────────────────────────────────────
echo "Creating issue 11/14: Pagination Cache Scaling..."
gh issue create --repo "$REPO" \
  --title "Scale pagination cache for multi-replica deployments" \
  --label "enhancement,production-readiness,scalability" \
  --body '## Problem

The `PaginationManager` uses an in-process LRU cache. In a multi-replica deployment, a pagination `_getpages` token created on replica A will not be found on replica B, causing `410 Gone` errors for clients during pagination.

## Current State

- `src/pagination.js:8-11` — in-process LRU cache: `max: 1000` entries, `ttl: 3600000` (1 hour)
- `src/routes.js:251-263` — `getState(token)` returns null if token not found → returns 410 Gone error
- Single-replica deployment works fine; multi-replica breaks pagination
- No session affinity configured in docker-compose.yml

## Proposed Solutions (evaluate in order)

### Option A: Stateless pagination tokens (recommended)
- Encode the source tokens directly in the pagination URL (e.g., base64-encoded JSON of source tokens)
- No server-side state needed — works with any number of replicas
- Trade-off: pagination URLs become longer
- No additional infrastructure dependencies

### Option B: Sticky sessions
- Configure the load balancer for session affinity (cookie-based or IP-based)
- Simplest change — no code modification needed
- Trade-off: uneven load distribution, not truly scalable

### Option C: Redis-backed cache
- Replace in-memory LRU with Redis-backed cache (e.g., `ioredis` + `lru-cache` adapter)
- Shared state across all replicas
- Trade-off: adds Redis as an infrastructure dependency

## Acceptance Criteria

- [ ] Pagination works correctly across multiple replicas
- [ ] No 410 errors due to token not found on a different replica
- [ ] Solution documented with trade-offs
- [ ] Performance impact measured and acceptable
- [ ] Existing pagination tests updated for chosen approach'

# ─── Issue 12 ──────────────────────────────────────────────────────────────────
echo "Creating issue 12/14: Input Validation..."
gh issue create --repo "$REPO" \
  --title "Add input validation and sanitization for query parameters" \
  --label "enhancement,production-readiness,security" \
  --body '## Problem

Query parameters from incoming requests are forwarded largely as-is to upstream FHIR servers. While `_count` is validated and resource types are whitelisted, other parameters are passed through without validation. Malformed or unexpected parameters could cause issues with upstream servers or be used for injection attacks.

## Current State

- `src/routes.js:308-310` — query params are spread into a new object and forwarded without validation
- `src/routes.js:191-195` — `_count` is validated and capped at 500 ✅
- `src/routes.js:295-306` — resource type is validated against a whitelist ✅
- No validation of other search parameters (e.g., `_include`, `_revinclude`, `_sort`, `_elements`)
- No protection against parameter pollution (duplicate params)
- Query parameter values are not sanitized before logging (potential log injection)

## Proposed Solution

1. **Validate query parameters:**
   - Strip unknown/dangerous parameters (or whitelist known FHIR search params)
   - Validate parameter value formats (e.g., dates must be ISO 8601, tokens must match expected patterns)
   - Prevent parameter pollution (handle duplicate parameter names)

2. **Sanitize for logging:**
   - Strip control characters and newlines from parameter values before logging
   - Prevent log injection attacks

3. **Limits:**
   - Limit the total number of query parameters per request
   - Limit individual parameter value length

4. **Error responses:**
   - Return 400 OperationOutcome for invalid parameters with clear diagnostics

## Acceptance Criteria

- [ ] Unknown or dangerous query parameters are rejected/stripped
- [ ] Parameter values are sanitized before logging
- [ ] Parameter pollution is handled
- [ ] Invalid parameters return 400 with FHIR OperationOutcome
- [ ] Standard FHIR search parameters continue to work correctly
- [ ] Existing tests pass; new tests cover validation edge cases'

# ─── Issue 13 ──────────────────────────────────────────────────────────────────
echo "Creating issue 13/14: Load Testing..."
gh issue create --repo "$REPO" \
  --title "Add automated load and performance testing" \
  --label "enhancement,production-readiness,testing" \
  --body '## Problem

There are no load or performance tests. It is impossible to validate that the mediator can handle expected production volumes, identify bottlenecks, or establish performance baselines. Without load tests, configuration changes or code changes could introduce performance regressions undetected.

## Current State

- `npm test` runs Jest unit/integration tests (functional correctness only)
- No load testing tools or scripts in the repository
- No defined performance SLOs (latency, throughput, error rate)
- No CI/CD performance gate
- `src/routes.js:311,325-329` — request timing is logged but not systematically measured

## Proposed Solution

1. **Add load test scripts** using k6 (recommended), Artillery, or Apache JMeter

2. **Define test scenarios:**
   - **Steady state:** N concurrent users querying different resource types
   - **Burst:** sudden spike of M requests
   - **Degraded:** one or more upstream sources down/slow
   - **Pagination:** sustained pagination through large result sets

3. **Define SLOs:**
   - p95 latency < 2s for single-page results
   - p99 latency < 5s
   - Error rate < 1% under steady state
   - Throughput: X requests/second sustained

4. **Test infrastructure:**
   - Create a Docker Compose profile for load testing (mediator + mock FHIR servers)
   - Mock servers should simulate realistic latency and response sizes

5. **CI integration (optional):**
   - Add performance test results to CI/CD pipeline as a gate

## Acceptance Criteria

- [ ] Load test scripts are committed and documented
- [ ] Tests can be run locally and in CI
- [ ] SLOs are defined and documented
- [ ] Baseline performance results are recorded
- [ ] README includes instructions for running load tests'

# ─── Issue 14 ──────────────────────────────────────────────────────────────────
echo "Creating issue 14/14: Upgrade Node.js..."
gh issue create --repo "$REPO" \
  --title "Upgrade Node.js runtime from 18 to 20 or 22 LTS" \
  --label "enhancement,production-readiness,maintenance" \
  --body '## Problem

The Dockerfile uses Node.js 18 (`FROM node:18-alpine`), which reached End of Life in April 2025. Running an EOL runtime in production means no security patches, no bug fixes, and potential compliance issues.

## Current State

- `Dockerfile:1` — `FROM node:18-alpine` (EOL since April 2025)
- `package.json` — no `engines` field specifying required Node.js version
- No CI matrix testing against multiple Node.js versions

## Proposed Solution

1. Upgrade `Dockerfile` to `FROM node:20-alpine` (LTS until April 2026) or `FROM node:22-alpine` (LTS until April 2027)
2. Add `engines` field to `package.json`:
   ```json
   "engines": {
     "node": ">=20.0.0"
   }
   ```
3. Run full test suite against the new Node.js version
4. Update any deprecated API usage if applicable
5. Consider adding CI matrix to test against both Node.js 20 and 22
6. Update `docker-compose.yml` if it references a specific image tag

## Acceptance Criteria

- [ ] Dockerfile uses Node.js 20 LTS or 22 LTS
- [ ] `package.json` has `engines` field
- [ ] All existing tests pass on new Node.js version
- [ ] No deprecated API warnings in test output
- [ ] CI tests against the target Node.js version'

echo ""
echo "==> All 14 issues created successfully!"
echo ""
echo "View issues at: https://github.com/$REPO/issues"
