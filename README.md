# FHIR Aggregator Mediator

An [OpenHIM](https://openhim.org/) mediator that aggregates FHIR R4 search results from multiple FHIR servers into a single endpoint. Designed for use with [google/fhir-data-pipes](https://github.com/google/fhir-data-pipes) to sync data from multiple sources to a shared FHIR store through a single pipeline.

## Problem

google/fhir-data-pipes supports a single `fhirServerUrl` as its data source. In deployments with multiple FHIR servers (e.g., one EMR per facility), you'd need to run a separate pipeline instance per server. This mediator presents all servers as a single FHIR endpoint.

## Compatible Sources

The mediator works with **any FHIR R4 server** that returns standard search Bundles:

- **OpenMRS** with the [FHIR2 module](https://wiki.openmrs.org/display/projects/FHIR+Module) (including iSantePlus)
- **HAPI FHIR** servers
- **Any FHIR R4 compliant server** that supports `_getpages` pagination

Sources can be mixed — you can aggregate an OpenMRS instance, a HAPI FHIR server, and any other FHIR R4 server in the same configuration.

## How It Works

```
                        ┌─────────────────┐
                        │  FHIR Server 1  │
                        │  (Facility A)   │
┌──────────────┐        ├─────────────────┤        ┌──────────────┐
│  fhir-data-  │  GET   │  FHIR Server 2  │  PUT   │              │
│  pipes       │──────> │  (Facility B)   │──────> │  HAPI FHIR   │
│  pipeline    │        ├─────────────────┤        │  (SHR)       │
│              │        │  FHIR Server 3  │        │              │
└──────────────┘        │  (Facility C)   │        └──────────────┘
       │                ├─────────────────┤               ▲
       │                │  FHIR Server N  │               │
       │                │  (Facility ...)  │               │
       │                └─────────────────┘               │
       │                        ▲                         │
       │                        │                         │
       ▼                        │                         │
┌──────────────────────────────────────┐                  │
│        FHIR Aggregator Mediator      │                  │
│                                      │                  │
│  1. Receives FHIR search request     │                  │
│  2. Fans out to all sources          │                  │
│  3. Merges & deduplicates results    │                  │
│  4. Handles offset-based pagination  │──────────────────┘
│  5. Returns unified Bundle           │   (pipeline writes
│                                      │    to sink FHIR store)
└──────────────────────────────────────┘
```

1. Pipeline sends a FHIR search to the aggregator (e.g., `GET /fhir/Patient?_count=100`)
2. Aggregator fans out the request to all configured sources in parallel
3. Responses are merged into a single Bundle with deduplication by resource ID
4. Pipeline uses offset-based pagination (`_getpages` + `_getpagesoffset`) to fetch all pages
5. Pipeline writes the aggregated data to the sink FHIR store

## Quick Start

### Docker

```bash
docker build -t fhir-aggregator-mediator .
docker run -p 3000:3000 fhir-aggregator-mediator
```

### Docker Swarm

```bash
docker stack deploy -c docker-compose.yml fhir-aggregator
```

### Verify

```bash
# Health check — shows per-source status
curl http://localhost:3000/health

# FHIR metadata
curl http://localhost:3000/fhir/metadata

# Search patients across all sources
curl http://localhost:3000/fhir/Patient?_count=20
```

## Setup & Configuration Guide

This section walks through how to configure a full deployment with the FHIR Aggregator Mediator sitting between your FHIR servers and a data pipeline (or any FHIR client).

All runtime configuration lives in `config/config.json`. Edit this file to match your environment — no code changes are needed.

### Step 1 — Define Your FHIR Sources

Add every FHIR server you want to aggregate to the `sources` array. Each entry requires:

| Field | Description |
|-------|-------------|
| `id` | A unique short identifier (used in logs, health endpoint, and environment variable overrides) |
| `name` | A human-readable label |
| `baseUrl` | The FHIR R4 base URL (must end at the FHIR root, e.g. `/fhir` or `/openmrs/ws/fhir2/R4`) |
| `username` | HTTP Basic Auth username (leave empty `""` if the source requires no authentication) |
| `password` | HTTP Basic Auth password (leave empty `""` if no authentication) |

```json
{
  "sources": [
    {
      "id": "facility-a",
      "name": "Facility A (OpenMRS)",
      "baseUrl": "http://openmrs-a:8080/openmrs/ws/fhir2/R4",
      "username": "admin",
      "password": "Admin123"
    },
    {
      "id": "facility-b",
      "name": "Facility B (HAPI FHIR)",
      "baseUrl": "http://hapi-fhir-b:8080/fhir",
      "username": "",
      "password": ""
    },
    {
      "id": "facility-c",
      "name": "Facility C (OpenMRS)",
      "baseUrl": "http://openmrs-c:8080/openmrs/ws/fhir2/R4",
      "username": "admin",
      "password": "Admin123"
    }
  ]
}
```

On startup the mediator validates every source by hitting its `/metadata` endpoint. If any source is unreachable or returns an error (including 401/403 auth failures), it will retry for up to 15 minutes (useful when upstream EMRs are still booting) and then exit with a clear error if validation still fails.

#### Environment Variable Overrides for Credentials

To avoid storing passwords in the config file, you can override credentials per source via environment variables:

```
SOURCE_{id}_USERNAME=admin
SOURCE_{id}_PASSWORD=s3cret
```

For example, given a source with `"id": "facility_a"`:

```bash
export SOURCE_facility_a_USERNAME=admin
export SOURCE_facility_a_PASSWORD=s3cret
```

> **Note:** The source `id` becomes part of the environment variable name. Use underscores rather than hyphens in source IDs so that the resulting variable names are portable across all shells (e.g. `facility_a` instead of `facility-a`).

This is especially useful for Docker deployments where you pass secrets through the environment or orchestrator secrets management:

```bash
docker run -p 3000:3000 \
  -e SOURCE_facility_a_PASSWORD=s3cret \
  -e SOURCE_facility_b_PASSWORD=other-secret \
  fhir-aggregator-mediator
```

### Step 2 — Configure the Application Port

```json
{
  "app": {
    "port": 3000
  }
}
```

The mediator listens on port `3000` by default. Change this if the port conflicts with other services in your stack.

### Step 3 — Configure OpenHIM Registration (Optional)

The mediator registers itself with [OpenHIM](https://openhim.org/) on startup and creates an HTTP channel at `/aggregated-fhir`. This is **optional** — the mediator works standalone at `http://localhost:3000/fhir` without OpenHIM.

```json
{
  "mediator": {
    "api": {
      "username": "root@openhim.org",
      "password": "instant101",
      "apiURL": "https://openhim-core:8080",
      "trustSelfSigned": true,
      "urn": "urn:mediator:fhir-aggregator"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `username` | OpenHIM admin username |
| `password` | OpenHIM admin password |
| `apiURL` | OpenHIM Core API URL |
| `trustSelfSigned` | Accept self-signed TLS certificates from OpenHIM (set `true` for development) |
| `urn` | Unique mediator URN registered with OpenHIM |

The channel configuration is defined in `config/mediator.json`. It maps incoming requests at `/aggregated-fhir` to the mediator's `/fhir` endpoint and restricts access to the `shr-pipeline` client:

```json
{
  "urn": "urn:mediator:fhir-aggregator",
  "version": "1.0.0",
  "name": "FHIR Aggregator",
  "defaultChannelConfig": [
    {
      "methods": ["GET"],
      "urlPattern": "^/aggregated-fhir.*$",
      "routes": [
        {
          "host": "fhir-aggregator",
          "port": 3000,
          "pathTransform": "s/\\/aggregated-fhir/\\/fhir/g",
          "primary": true
        }
      ],
      "allow": ["shr-pipeline"]
    }
  ]
}
```

If OpenHIM is unreachable at startup the mediator logs a warning and continues running — it does not block.

### Step 4 — Configure Deduplication

The mediator deduplicates resources that appear in more than one source. This is common when EMR instances are cloned from the same database template and share identical Practitioner, Location, and other reference data.

Two strategies are supported:

| Strategy | Key used | Best for |
|----------|----------|----------|
| `resourceId` (default) | `{resourceType}/{id}` | Resources with server-assigned IDs that may overlap across cloned instances |
| `identifier` | `{resourceType}/{identifier.value}` matching a given `system` | Resources with a shared business identifier (e.g. a national patient ID) |

Configure per resource type in `config/config.json`. Any resource type not explicitly listed falls back to `default`:

```json
{
  "deduplication": {
    "Patient": {
      "strategy": "identifier",
      "system": "http://national-cr.org/master-id"
    },
    "default": {
      "strategy": "resourceId"
    }
  }
}
```

In this example:
- **Patient** resources are deduplicated by a national master patient identifier. Two Patient resources from different facilities with the same `identifier.value` under the system `http://national-cr.org/master-id` are treated as the same patient.
- **All other resource types** are deduplicated by `resourceType/id`. If two facilities both have a `Practitioner/1`, only one copy appears in the aggregated results.

### Step 5 — Tune Performance Settings

```json
{
  "performance": {
    "timeoutMs": 30000,
    "maxSocketsPerSource": 5,
    "rejectUnauthorized": true
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `timeoutMs` | `30000` | Per-source HTTP request timeout in milliseconds. Increase for slow sources. |
| `maxSocketsPerSource` | `5` | Maximum concurrent TCP connections per upstream source. Connection pooling with keep-alive is enabled automatically. |
| `rejectUnauthorized` | `true` | Set to `false` to accept self-signed TLS certificates from upstream FHIR servers (development only). |

There is also a request-level timeout at the Express layer (`requestTimeoutMs`, default `120000` ms) that guards against slow upstreams hanging the HTTP response indefinitely. If a request exceeds this limit the mediator returns HTTP 504 with a FHIR OperationOutcome. To override the default, add `requestTimeoutMs` to the `performance` section:

```json
{
  "performance": {
    "timeoutMs": 30000,
    "requestTimeoutMs": 120000,
    "maxSocketsPerSource": 5,
    "rejectUnauthorized": true
  }
}
```

### Step 6 — Configure Pagination Cache

Pagination state (per-source `_getpages` tokens) is stored in an in-memory LRU cache:

```json
{
  "pagination": {
    "cacheMaxSize": 1000,
    "cacheTtlMs": 3600000
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `cacheMaxSize` | `1000` | Maximum concurrent pagination sessions before the oldest is evicted |
| `cacheTtlMs` | `3600000` | Token expiry in milliseconds (default: 1 hour). Set this longer than your longest pipeline run. |

### Step 7 — Point Your Pipeline at the Aggregator

Configure the [fhir-data-pipes](https://github.com/google/fhir-data-pipes) pipeline to use the aggregator as its FHIR source in `application.yaml`:

```yaml
fhirdata:
  fhirServerUrl: "http://fhir-aggregator:3000/fhir"
  fhirServerUserName: ""
  fhirServerPassword: ""
```

The aggregator handles authentication to each upstream source internally — the pipeline itself does not need credentials.

### Full Configuration Reference

Below is a complete `config/config.json` showing every available option:

```json
{
  "app": {
    "port": 3000
  },
  "mediator": {
    "api": {
      "username": "root@openhim.org",
      "password": "instant101",
      "apiURL": "https://openhim-core:8080",
      "trustSelfSigned": true,
      "urn": "urn:mediator:fhir-aggregator"
    }
  },
  "sources": [
    {
      "id": "facility-a",
      "name": "Facility A (OpenMRS)",
      "baseUrl": "http://openmrs-a:8080/openmrs/ws/fhir2/R4",
      "username": "admin",
      "password": "Admin123"
    },
    {
      "id": "facility-b",
      "name": "Facility B (HAPI FHIR)",
      "baseUrl": "http://hapi-fhir-b:8080/fhir",
      "username": "",
      "password": ""
    }
  ],
  "pagination": {
    "cacheMaxSize": 1000,
    "cacheTtlMs": 3600000
  },
  "deduplication": {
    "Patient": { "strategy": "identifier", "system": "http://national-cr.org/master-id" },
    "default": { "strategy": "resourceId" }
  },
  "performance": {
    "timeoutMs": 30000,
    "requestTimeoutMs": 120000,
    "maxSocketsPerSource": 5,
    "rejectUnauthorized": true
  }
}
```

### Deploying with Docker Swarm

The included `docker-compose.yml` is designed for Docker Swarm. It injects both config files as Docker configs and attaches the mediator to the `openhim` and `isanteplus` overlay networks:

```bash
# Build the image
docker build -t fhir-aggregator-mediator .

# Deploy to the swarm
docker stack deploy -c docker-compose.yml fhir-aggregator
```

To customize configuration for your environment, edit `config/config.json` and `config/mediator.json` before deploying. Docker Swarm will mount them into the container at `/app/config/`.

Resource limits are set in the compose file (512 MB memory, 0.5 CPU) and can be adjusted to fit your deployment.

## API

### `GET /fhir/metadata`

Returns a synthetic CapabilityStatement listing all 161 supported FHIR R4 resource types.

### `GET /fhir/:resourceType?_count=N&_since=...`

Searches all configured sources in parallel, merges results, deduplicates, and returns a FHIR Bundle. All query parameters are passed through to each source.

- `_count` — page size (default: 20, max: 500)
- `_since` — passed through for incremental sync

If results span multiple pages, the Bundle includes a `next` link with a `_getpages` token.

### `GET /fhir?_getpages=TOKEN&_getpagesoffset=N&_count=M`

Offset-based pagination. The token maps to per-source `_getpages` tokens stored in the LRU cache. The offset and count are forwarded to each source.

### `GET /health`

Returns per-source health status:

```json
{
  "status": "UP",
  "sources": [
    { "id": "facility-a", "status": "UP", "name": "Facility A", "lastError": null, "lastChecked": "..." },
    { "id": "facility-b", "status": "DOWN", "name": "Facility B", "lastError": "ECONNREFUSED", "lastChecked": "..." }
  ]
}
```

Returns HTTP 200 when all sources are UP, HTTP 503 when any source is DOWN or AUTH_FAILED.

## Source Health Monitoring

### Startup Validation

On startup, the mediator validates credentials for every configured source by hitting `/metadata`. If any source is unavailable, the mediator retries for up to 15 minutes (90 attempts × 10 seconds) to allow slow-starting upstream services (e.g. iSantePlus) to boot. If validation still fails after all retries, the mediator **exits immediately** with a clear error message instead of silently serving incomplete data.

### Per-Request Tracking

When a source fails during a request, the response includes headers indicating which sources were unavailable:

```
X-Aggregator-Sources-Failed: facility-b,facility-c
X-Aggregator-Sources-Failed-Count: 2
```

This allows monitoring systems to detect degraded operation.

## Deduplication-Aware Pagination Totals

When aggregating paginated results from multiple FHIR servers, the naive approach of summing each source's `Bundle.total` overestimates the number of unique resources — cloned EMR instances often share identical Practitioner, Location, and other reference data.

Per the FHIR R4 specification, `Bundle.total` **SHALL only be provided when the value is accurately calculated**. Since the mediator cannot know the exact deduplicated total without fetching every page, it applies a best-effort approximation using the deduplication ratio observed on the first page of results:

```
adjustedTotal ≈ rawTotal × (dedupedEntries / rawEntries)
```

This estimate is significantly more accurate than the raw sum and prevents downstream consumers such as [fhir-data-pipes](https://github.com/google/fhir-data-pipes) from creating more pagination segments than actually contain data. In practice, the deduplication ratio on the first page is a reliable proxy for the overall ratio because shared reference data (Practitioner, Location, etc.) appears consistently across pages.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Source down during request | Warning logged, results from remaining sources returned, `X-Aggregator-Sources-Failed` header set |
| Source auth fails on startup | Mediator retries for up to 15 min, then exits with `FATAL: Source validation failed` |
| Source auth fails during request | Source marked as `AUTH_FAILED` in health, remaining sources still serve data |
| Pagination token expired | HTTP 410 Gone returned, pipeline retries on next schedule |
| All sources down | Empty Bundle returned |
| Request timeout (>120 s) | HTTP 504 with FHIR OperationOutcome |

## Architecture

```
src/
  index.js            # Express server, startup validation, OpenHIM registration
  routes.js           # Request routing, Bundle construction, resource type validation
  aggregator.js       # Fan-out, merge, deduplication, offset pagination
  pagination.js       # LRU cache for pagination state tokens
  fhir-client.js      # HTTP client with Basic Auth, connection pooling, timeout
  source-monitor.js   # Startup validation, per-request health tracking
config/
  config.json         # Runtime config (sources, deduplication, performance, pagination, OpenHIM)
  mediator.json       # OpenHIM mediator registration metadata and channel config
tests/
  unit/               # Unit tests (aggregator, pagination, source-monitor, fhir-client)
  integration/        # Route tests via supertest
  fixtures/           # Reusable FHIR Bundles and mock sources
```

## Development

```bash
# Install dependencies
npm install

# Run tests (71 tests, ~99% coverage)
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Auto-fix formatting
npm run format
```

## License

MPL-2.0
