# Production Readiness — Tracked Issues

This document lists 14 issues that need to be addressed to make the FHIR Aggregator Mediator production-ready for high-volume deployments. Each issue is described with context, rationale, current state, and acceptance criteria.

Use the companion script `create-issues.sh` to create all 14 issues in GitHub automatically.

---

## Issue 1: Add Clustering / Horizontal Scaling Support

**Labels:** `enhancement`, `production-readiness`, `scalability`

The mediator currently runs as a single Node.js process (`node src/index.js`), which means it can only use one CPU core. Under high request volumes, the single event loop becomes a bottleneck — especially during CPU-intensive deduplication of large result sets in `aggregator.js` or when fanning out to many upstream FHIR servers.

### Current state
- `src/index.js` starts a single Express server on one process
- `Dockerfile` runs `CMD ["node", "src/index.js"]` — single process
- `docker-compose.yml` defines one replica with 0.5 CPU limit

### What needs to change
- Add Node.js `cluster` module support to fork worker processes equal to available CPU cores
- Each worker runs its own Express server sharing the same port
- The master process handles worker lifecycle (restart on crash, graceful shutdown propagation)
- Alternatively, document how to run multiple container replicas behind a load balancer
- Consider the implications for the in-process LRU pagination cache (see Issue 11)

### Acceptance criteria
- [ ] Mediator can utilize multiple CPU cores
- [ ] Worker crash is automatically recovered
- [ ] Graceful shutdown propagates to all workers
- [ ] Documentation updated with scaling guidance

---

## Issue 2: Replace Console Logging with Structured Logger

**Labels:** `enhancement`, `production-readiness`, `observability`

The mediator uses raw `console.log()` and `console.error()` throughout all source files (`index.js`, `routes.js`, `aggregator.js`, `source-monitor.js`). These log lines lack timestamps, log levels, request correlation IDs, and structured fields — making them unusable with log aggregation systems (ELK, Grafana Loki, Splunk, CloudWatch).

### Current state
- `src/aggregator.js:3` — `const logger = console;`
- `src/index.js` — uses `console.log`, `console.warn`, `console.error` directly
- `src/routes.js:327` — logs request metrics as unstructured string
- `src/source-monitor.js` — uses `console.log` and `console.error`
- No request correlation IDs — impossible to trace a request across log lines

### What needs to change
- Replace `console` with a structured JSON logger like `pino` (fastest for Node.js) or `winston`
- Generate a UUID correlation ID per incoming request (middleware), pass it through to upstream calls
- Log in JSON format with fields: `level`, `timestamp`, `correlationId`, `sourceId`, `resourceType`, `responseTimeMs`, `statusCode`, `message`
- Use log levels consistently: `info` for normal operations, `warn` for degraded sources, `error` for failures, `debug` for verbose tracing
- Support configurable log level via environment variable (e.g., `LOG_LEVEL=info`)

### Acceptance criteria
- [ ] All log output is structured JSON
- [ ] Every request gets a unique correlation ID visible in logs
- [ ] Log level is configurable via environment variable
- [ ] Existing tests still pass
- [ ] README documents logging configuration

---

## Issue 3: Add Prometheus Metrics and Observability Endpoint

**Labels:** `enhancement`, `production-readiness`, `observability`

There is currently no way to monitor the mediator's throughput, latency percentiles, error rates, or upstream health in real time. The `/health` endpoint provides basic UP/DOWN status but no quantitative metrics. Production deployments need Prometheus-compatible metrics for dashboards and alerting.

### Current state
- `/health` endpoint in `src/index.js:56-60` returns per-source UP/DOWN/AUTH_FAILED status
- Request timing is logged as a string in `src/routes.js:326-329` but not exposed as a metric
- No `/metrics` endpoint exists
- No integration with any metrics library

### What needs to change
- Add `prom-client` library to expose a `/metrics` endpoint in Prometheus exposition format
- Implement the following metrics:
  - `http_request_duration_seconds` — histogram with labels: `method`, `route`, `status_code`
  - `http_requests_total` — counter with labels: `method`, `route`, `status_code`
  - `upstream_request_duration_seconds` — histogram with labels: `source_id`, `resource_type`
  - `upstream_errors_total` — counter with labels: `source_id`, `error_type`
  - `active_requests` — gauge of currently in-flight requests
  - `pagination_cache_size` — gauge of current LRU cache entries
  - `pagination_cache_hits_total` / `pagination_cache_misses_total` — counters
  - `dedup_removed_total` — counter of duplicates removed per request
- Consider adding OpenTelemetry tracing for distributed tracing of fan-out requests

### Acceptance criteria
- [ ] `/metrics` endpoint returns Prometheus-compatible metrics
- [ ] All key metrics listed above are implemented
- [ ] Metrics are accurate under concurrent load
- [ ] Documentation includes Prometheus scrape configuration example
- [ ] Optional: Grafana dashboard JSON provided

---

## Issue 4: Implement Circuit Breaker Pattern for Upstream Sources

**Labels:** `enhancement`, `production-readiness`, `resilience`

When an upstream FHIR server is down or slow, every incoming request still attempts to call it. This adds unnecessary latency to every aggregated response and wastes resources. The `SourceMonitor` class (`src/source-monitor.js`) tracks per-source health status but does not prevent calls to known-down sources.

### Current state
- `src/aggregator.js:35-47` — `searchAll()` fans out to ALL sources on every request via `Promise.all()`
- `src/source-monitor.js:60-84` — records success/failure per source but doesn't gate future calls
- A single slow/down source adds its full timeout (30s default) to every request's latency
- With 4 sources, one down source means every request takes ≥30s instead of returning partial results quickly

### What needs to change
- Implement a circuit breaker per upstream source (e.g., using `opossum` library or custom implementation)
- Circuit states: CLOSED (normal) → OPEN (after N consecutive failures, skip source) → HALF-OPEN (periodic probe to check recovery)
- When a circuit is OPEN, immediately skip that source — no request sent, no timeout waited
- Configurable thresholds: `failureThreshold` (e.g., 5), `resetTimeoutMs` (e.g., 30000)
- Integrate circuit state into `/health` endpoint response
- Log circuit state transitions (CLOSED→OPEN, OPEN→HALF-OPEN, HALF-OPEN→CLOSED)

### Acceptance criteria
- [ ] Circuit breaker prevents calls to known-down sources
- [ ] Circuit automatically recovers when source comes back online
- [ ] Thresholds are configurable via config.json
- [ ] `/health` endpoint shows circuit breaker state per source
- [ ] Response latency is not impacted by down sources (after circuit opens)
- [ ] Existing tests pass; new tests cover circuit breaker behavior

---

## Issue 5: Add Retry with Exponential Backoff for Transient Upstream Failures

**Labels:** `enhancement`, `production-readiness`, `resilience`

Upstream FHIR server requests in `FhirClient` (`src/fhir-client.js`) have no retry logic. A single transient failure (network blip, 503 Service Unavailable, ECONNRESET) causes the entire source to be reported as failed for that request. This leads to unnecessary data loss in aggregated results.

### Current state
- `src/fhir-client.js:39-52` — `search()` makes a single axios call; any error propagates immediately
- `src/fhir-client.js:55-67` — `fetchUrl()` same behavior for pagination fetches
- `src/aggregator.js:42-46` — errors are caught and source is marked as failed
- No distinction between transient errors (retryable) and permanent errors (not retryable)

### What needs to change
- Add configurable retry logic with exponential backoff for transient errors
- Retryable errors: HTTP 502, 503, 504, ECONNRESET, ETIMEDOUT, ECONNREFUSED
- Non-retryable errors: HTTP 400, 401, 403, 404 (client errors)
- Configuration: `maxRetries` (default: 3), `initialDelayMs` (default: 500), `maxDelayMs` (default: 5000)
- Options: use `axios-retry` library or implement manually
- Add jitter to backoff delay to avoid thundering herd on upstream recovery
- Log each retry attempt with attempt number and delay

### Acceptance criteria
- [ ] Transient upstream errors are retried automatically
- [ ] Client errors (4xx) are NOT retried
- [ ] Retry count, delay, and max delay are configurable
- [ ] Jitter is applied to prevent thundering herd
- [ ] Retries are logged at `warn` level
- [ ] Existing tests pass; new tests cover retry behavior

---

## Issue 6: Add Rate Limiting and Concurrency Controls

**Labels:** `enhancement`, `production-readiness`, `resilience`

There is no protection against request floods. Each incoming request fans out to N upstream FHIR servers, meaning a burst of 100 concurrent requests generates 400 upstream requests (with 4 sources). This can overwhelm upstream servers and exhaust Node.js memory/connections.

### Current state
- No inbound rate limiting — any client can send unlimited requests
- No concurrency limiting — all fan-out requests execute simultaneously
- `src/fhir-client.js:19` — `maxSockets` is limited to 5 per source (TCP-level only)
- No backpressure mechanism when upstreams are slow
- `docker-compose.yml` limits memory to 512M but no request-level protection

### What needs to change
- Add inbound rate limiting middleware (e.g., `express-rate-limit`)
  - Configurable: requests per window, window size, per-IP or global
  - Return `429 Too Many Requests` with FHIR OperationOutcome when exceeded
- Add concurrency limiting — cap the number of in-flight upstream requests
  - Use a semaphore/queue pattern to prevent overwhelming upstreams
  - Configurable: `maxConcurrentUpstreamRequests` (e.g., 50)
- Return proper `Retry-After` header on 429 responses
- Expose rate limit metrics (see Issue 3)

### Acceptance criteria
- [ ] Inbound rate limiting prevents request floods
- [ ] 429 responses include proper FHIR OperationOutcome and Retry-After header
- [ ] Concurrent upstream requests are bounded
- [ ] Rate limits are configurable via config.json / environment variables
- [ ] Rate limit metrics are exposed
- [ ] Existing tests pass; new tests cover rate limiting

---

## Issue 7: Security Hardening (HTTP Headers, Non-root Container, Body Limits)

**Labels:** `enhancement`, `production-readiness`, `security`

The mediator lacks standard HTTP security headers, runs as root in the Docker container, and has no request body size limits. These are baseline security requirements for any production-facing HTTP service.

### Current state
- No HTTP security headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.)
- `Dockerfile:1` — `FROM node:18-alpine` runs as root by default (no `USER` directive)
- No request body size limits configured in Express
- No CORS configuration
- No `--max-old-space-size` Node.js flag to prevent OOM crashes
- Credentials stored in `config/config.json` in plaintext (mitigated partially by env var overrides in `src/index.js:15-20`)

### What needs to change
- Add `helmet` middleware for HTTP security headers
- Add `USER node` directive in Dockerfile to run as non-root
- Add `express.json({ limit: '1mb' })` middleware for body size limits
- Add `--max-old-space-size=384` to Node.js CMD in Dockerfile (within 512M container limit)
- Configure CORS if the mediator may be accessed from browser-based clients
- Ensure all credential env var overrides are documented
- Add `.dockerignore` if not present to prevent leaking secrets into image

### Acceptance criteria
- [ ] Security headers present on all responses (verify with `curl -I`)
- [ ] Docker container runs as non-root user
- [ ] Request body size is limited
- [ ] Node.js heap size is bounded to prevent container OOM
- [ ] Security scan (e.g., `npm audit`, `trivy`) shows no critical vulnerabilities
- [ ] README documents security configuration

---

## Issue 8: Add Response Compression (gzip/deflate)

**Labels:** `enhancement`, `production-readiness`, `performance`

FHIR Bundle responses can be very large (thousands of entries with verbose JSON). Currently, all responses are sent uncompressed, wasting bandwidth and increasing response times — especially for clients on slow networks or in bandwidth-constrained environments.

### Current state
- `src/routes.js:197-198` — `fhirJson()` sends JSON responses with no compression
- No `compression` middleware configured in `src/index.js`
- Typical FHIR JSON compresses 70-80% with gzip

### What needs to change
- Add `compression` middleware (npm `compression` package) to Express
- Configure minimum response size threshold (e.g., 1KB) to avoid compressing tiny responses
- Ensure `Content-Encoding` header is set correctly
- Make compression configurable (enable/disable via config) for environments where a reverse proxy handles compression

### Acceptance criteria
- [ ] Responses are gzip-compressed when client sends `Accept-Encoding: gzip`
- [ ] Small responses are not compressed (configurable threshold)
- [ ] Compression is configurable (can be disabled)
- [ ] No impact on response correctness
- [ ] Bandwidth reduction verified with sample large bundle

---

## Issue 9: Improve Configuration Management (Full Env Var Support, Validation)

**Labels:** `enhancement`, `production-readiness`, `operations`

Configuration is primarily managed through a static JSON file (`config/config.json`). Only credentials and the OpenHIM API URL support environment variable overrides (`src/index.js:15-30`). Adding or modifying sources requires editing the JSON file and redeploying — a significant operational burden.

### Current state
- `config/config.json` — static file with all configuration
- `src/index.js:15-20` — env var overrides for `SOURCE_{id}_USERNAME` and `SOURCE_{id}_PASSWORD`
- `src/index.js:23-30` — env var overrides for `OPENHIM_API_USERNAME`, `OPENHIM_API_PASSWORD`, `OPENHIM_API_URL`
- No env var support for: app port, source URLs, pagination settings, performance settings
- No configuration validation on startup
- No way to reload configuration without restart

### What needs to change
- Support full configuration via environment variables:
  - `APP_PORT` for server port
  - `SOURCES` as JSON string env var for complete source list, OR individual `SOURCE_1_URL`, `SOURCE_1_ID` patterns
  - `PAGINATION_CACHE_MAX_SIZE`, `PAGINATION_CACHE_TTL_MS`
  - `PERFORMANCE_TIMEOUT_MS`, `PERFORMANCE_MAX_SOCKETS_PER_SOURCE`
- Add startup configuration validation:
  - Validate required fields (source URLs, IDs)
  - Validate URL formats
  - Validate numeric ranges (port, timeouts)
  - Fail fast with clear error messages for invalid config
- Document all configuration options with defaults and examples
- Consider supporting config reload via SIGHUP signal or admin endpoint

### Acceptance criteria
- [ ] All config values can be overridden via environment variables
- [ ] Invalid configuration is caught at startup with clear error messages
- [ ] README includes a complete configuration reference table
- [ ] Docker/Kubernetes deployment can be fully configured without mounting config files
- [ ] Existing tests pass

---

## Issue 10: Add Kubernetes / Container Orchestration Readiness

**Labels:** `enhancement`, `production-readiness`, `deployment`

The mediator only has Docker Compose manifests. For production deployments, Kubernetes is the standard orchestration platform. The mediator also lacks a dedicated readiness probe — the `/health` endpoint serves both liveness and readiness checks, which have different semantics in Kubernetes.

### Current state
- `docker-compose.yml` — basic Docker Swarm deployment with resource limits
- `Dockerfile:15-16` — single `HEALTHCHECK` used for both liveness and readiness
- `/health` endpoint (`src/index.js:56-60`) returns 503 when any source is down (DEGRADED)
- No `/ready` endpoint — during the 15-minute startup validation loop, the container is not ready but the health endpoint doesn't exist yet
- No Kubernetes manifests, Helm chart, or HPA configuration

### What needs to change
- Add a separate `/ready` endpoint:
  - Returns 503 during startup (while sources are being validated)
  - Returns 200 once all sources pass initial validation
  - Distinct from `/health` (liveness) which can return 200 even during degraded operation
- Create Kubernetes manifests or Helm chart:
  - Deployment with configurable replicas
  - Service (ClusterIP)
  - Liveness probe → `/health`
  - Readiness probe → `/ready`
  - HorizontalPodAutoscaler (HPA) based on CPU/custom metrics
  - PodDisruptionBudget (PDB) for rolling updates
  - ConfigMap and Secret for configuration
- Set `terminationGracePeriodSeconds` to match the graceful shutdown timeout in `src/index.js:127-128`

### Acceptance criteria
- [ ] `/ready` endpoint correctly reflects startup state
- [ ] Kubernetes manifests or Helm chart provided
- [ ] HPA scales based on CPU (and optionally custom metrics)
- [ ] Rolling updates don't cause downtime (PDB)
- [ ] Graceful shutdown works correctly in Kubernetes (SIGTERM handling)
- [ ] Documentation includes Kubernetes deployment guide

---

## Issue 11: Scale Pagination Cache for Multi-Replica Deployments

**Labels:** `enhancement`, `production-readiness`, `scalability`

The `PaginationManager` (`src/pagination.js`) uses an in-process LRU cache. In a multi-replica deployment, a pagination `_getpages` token created on replica A will not be found on replica B, causing 410 Gone errors for clients during pagination.

### Current state
- `src/pagination.js:8-11` — LRU cache with `max: 1000`, `ttl: 3600000` (1 hour), in-process memory
- `src/routes.js:251-263` — `getState(token)` returns null if token not found → 410 error
- Single-replica deployment works fine; multi-replica breaks pagination
- No session affinity configured in docker-compose.yml

### What needs to change

Choose one of three approaches (recommend evaluating in this order):

**Option A: Stateless pagination tokens (recommended)**
- Encode the source tokens directly in the pagination URL (e.g., base64-encoded JSON of source tokens)
- No server-side state needed — works with any number of replicas
- Trade-off: pagination URLs become longer

**Option B: Sticky sessions**
- Configure the load balancer for session affinity (cookie-based or IP-based)
- Simplest change — no code modification needed
- Trade-off: uneven load distribution

**Option C: Redis-backed cache**
- Replace in-memory LRU with Redis-backed cache
- Shared state across all replicas
- Trade-off: adds Redis as an infrastructure dependency

### Acceptance criteria
- [ ] Pagination works correctly across multiple replicas
- [ ] No 410 errors due to token not found on a different replica
- [ ] Solution documented with trade-offs
- [ ] Performance impact measured and acceptable
- [ ] Existing pagination tests updated

---

## Issue 12: Add Input Validation and Sanitization for Query Parameters

**Labels:** `enhancement`, `production-readiness`, `security`

Query parameters from incoming requests are forwarded largely as-is to upstream FHIR servers. While the `_count` parameter is validated and capped at 500 (`src/routes.js:191-195`), other parameters are passed through without validation. Malformed or unexpected parameters could cause issues with upstream servers or be used for injection attacks.

### Current state
- `src/routes.js:308-310` — query params are spread into a new object and forwarded
- `src/routes.js:191-195` — `_count` is validated (parsed, capped at 500) — good
- `src/routes.js:295-306` — resource type is validated against a whitelist — good
- No validation of other search parameters (e.g., `_include`, `_revinclude`, `_sort`, `_elements`)
- No protection against parameter pollution (duplicate params)
- Query parameter values are not sanitized before logging

### What needs to change
- Validate and sanitize query parameters before forwarding to upstream servers:
  - Strip unknown/dangerous parameters (or whitelist known FHIR search params)
  - Validate parameter value formats (e.g., dates, references, tokens)
  - Prevent parameter pollution (handle duplicate parameter names)
- Sanitize parameter values before logging to prevent log injection
- Consider limiting the total number of query parameters per request
- Return 400 OperationOutcome for invalid parameters with clear diagnostics

### Acceptance criteria
- [ ] Unknown or dangerous query parameters are rejected/stripped
- [ ] Parameter values are sanitized before logging
- [ ] Parameter pollution is handled
- [ ] Invalid parameters return 400 with FHIR OperationOutcome
- [ ] Standard FHIR search parameters continue to work correctly
- [ ] Existing tests pass; new tests cover validation

---

## Issue 13: Add Automated Load and Performance Testing

**Labels:** `enhancement`, `production-readiness`, `testing`

There are no load or performance tests. It is impossible to validate that the mediator can handle expected production volumes, identify bottlenecks, or establish performance baselines. Without load tests, configuration changes or code changes could introduce performance regressions undetected.

### Current state
- `npm test` runs Jest unit/integration tests (functional correctness only)
- No load testing tools or scripts
- No defined performance SLOs (latency, throughput, error rate)
- No CI/CD performance gate
- `src/routes.js:311,325-329` — request timing is logged but not systematically measured

### What needs to change
- Add load test scripts using k6, Artillery, or Apache JMeter
- Define test scenarios:
  - **Steady state**: N concurrent users querying different resource types
  - **Burst**: sudden spike of M requests
  - **Degraded**: one or more upstream sources down/slow
  - **Pagination**: sustained pagination through large result sets
- Define SLOs:
  - p95 latency < 2s for single-page results
  - p99 latency < 5s
  - Error rate < 1% under steady state
  - Throughput: X requests/second sustained
- Create a Docker Compose profile for load testing (mediator + mock FHIR servers)
- Add performance test results to CI/CD pipeline (optional gate)

### Acceptance criteria
- [ ] Load test scripts are committed and documented
- [ ] Tests can be run locally and in CI
- [ ] SLOs are defined and documented
- [ ] Baseline performance results are recorded
- [ ] README includes instructions for running load tests

---

## Issue 14: Upgrade Node.js Runtime from 18 to 20 or 22 LTS

**Labels:** `enhancement`, `production-readiness`, `maintenance`

The Dockerfile uses Node.js 18 (`FROM node:18-alpine`), which reached End of Life in April 2025. Running an EOL runtime in production means no security patches, no bug fixes, and potential compliance issues.

### Current state
- `Dockerfile:1` — `FROM node:18-alpine`
- `package.json` — no `engines` field specifying required Node.js version
- No CI matrix testing against multiple Node.js versions

### What needs to change
- Upgrade `Dockerfile` to `FROM node:20-alpine` (LTS until April 2026) or `FROM node:22-alpine` (LTS until April 2027)
- Add `engines` field to `package.json` specifying minimum Node.js version
- Test the mediator against the new Node.js version (run full test suite)
- Update any deprecated API usage if applicable
- Consider adding CI matrix to test against both Node.js 20 and 22
- Update `docker-compose.yml` if it references a specific image tag

### Acceptance criteria
- [ ] Dockerfile uses Node.js 20 LTS or 22 LTS
- [ ] `package.json` has `engines` field
- [ ] All existing tests pass on new Node.js version
- [ ] No deprecated API warnings in test output
- [ ] CI tests against the target Node.js version
