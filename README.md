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

## Configuration

All configuration is in `config/config.json`.

### Sources

Add or remove FHIR servers in the `sources` array — no code changes required:

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

Leave `username` and `password` empty for sources that don't require authentication.

### OpenHIM Registration

The mediator registers with OpenHIM on startup and creates a channel at `/aggregated-fhir`. This is optional — the mediator works standalone at `http://localhost:3000/fhir` without OpenHIM.

```json
{
  "mediator": {
    "api": {
      "username": "root@openhim.org",
      "password": "instant101",
      "apiURL": "https://openhim-core:8080",
      "trustSelfSigned": true
    }
  }
}
```

### Pagination Cache

Pagination state (per-source `_getpages` tokens) is stored in an in-memory LRU cache:

```json
{
  "pagination": {
    "cacheMaxSize": 1000,
    "cacheTtlMs": 3600000
  }
}
```

- `cacheMaxSize`: Maximum concurrent pagination sessions (default: 1000)
- `cacheTtlMs`: Token expiry in milliseconds (default: 1 hour). Set this longer than your longest pipeline run.

## Pipeline Integration

Point the fhir-data-pipes pipeline at the aggregator in `application.yaml`:

```yaml
fhirdata:
  fhirServerUrl: "http://fhir-aggregator:3000/fhir"
  fhirServerUserName: ""
  fhirServerPassword: ""
```

The aggregator handles authentication to each source internally — the pipeline doesn't need credentials.

## API

### `GET /fhir/metadata`

Returns a synthetic CapabilityStatement listing supported resource types.

### `GET /fhir/:resourceType?_count=N&_since=...`

Searches all configured sources in parallel, merges results, deduplicates by resource ID, and returns a FHIR Bundle. All query parameters are passed through to each source.

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

On startup, the mediator validates credentials for every configured source by hitting `/metadata`. If any source returns 401/403, the mediator **exits immediately** with a clear error message instead of silently serving incomplete data.

### Per-Request Tracking

When a source fails during a request, the response includes headers indicating which sources were unavailable:

```
X-Aggregator-Sources-Failed: facility-b,facility-c
X-Aggregator-Sources-Failed-Count: 2
```

This allows monitoring systems to detect degraded operation.

## Deduplication

Resources are deduplicated by `resourceType/id`. This handles the common case where multiple EMR instances are cloned from the same database template and share identical Practitioner, Location, and other reference data.

Resources with unique IDs across instances (Patients, Encounters, Observations created after deployment) pass through without deduplication.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Source down during request | Warning logged, results from remaining sources returned, `X-Aggregator-Sources-Failed` header set |
| Source auth fails on startup | Mediator exits with `FATAL: Source validation failed` |
| Source auth fails during request | Source marked as `AUTH_FAILED` in health, remaining sources still serve data |
| Pagination token expired | HTTP 410 Gone returned, pipeline retries on next schedule |
| All sources down | Empty Bundle returned |

## Development

```bash
# Install dependencies
npm install

# Run tests (45 tests, ~98% coverage)
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Auto-fix formatting
npm run format
```

## Architecture

```
src/
  index.js            # Express server, startup validation, OpenHIM registration
  routes.js           # Request routing, Bundle construction
  aggregator.js       # Fan-out, merge, deduplication, offset pagination
  pagination.js       # LRU cache for pagination state tokens
  fhir-client.js      # HTTP client with Basic Auth for upstream sources
  source-monitor.js   # Startup validation, per-request health tracking
config/
  config.json         # Runtime config (sources, OpenHIM, pagination)
  mediator.json       # OpenHIM mediator registration metadata
tests/
  unit/               # Unit tests (aggregator, pagination, source-monitor, fhir-client)
  integration/        # Route tests via supertest
  fixtures/           # Reusable FHIR Bundles and mock sources
```

## Deduplication-Aware Pagination Totals

When aggregating paginated results from multiple FHIR servers, the naive approach of summing each source's `Bundle.total` overestimates the number of unique resources — cloned EMR instances often share identical Practitioner, Location, and other reference data.

Per the FHIR R4 specification, `Bundle.total` **SHALL only be provided when the value is accurately calculated**. To honour this, the mediator applies the deduplication ratio observed on the first page of results to estimate the true total:

```
adjustedTotal ≈ rawTotal × (dedupedEntries / rawEntries)
```

This prevents downstream consumers such as [fhir-data-pipes](https://github.com/google/fhir-data-pipes) from creating more pagination segments than actually contain data.

## License

MPL-2.0
