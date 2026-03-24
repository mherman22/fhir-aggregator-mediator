# FHIR Aggregator Mediator

An [OpenHIM](https://openhim.org/) mediator that aggregates FHIR R4 search results from multiple [iSantePlus](https://isanteplus.com/) (OpenMRS) instances into a single endpoint. Built for use with [google/fhir-data-pipes](https://github.com/google/fhir-data-pipes) to sync data from multiple EMR instances to a shared FHIR store.

## Problem

google/fhir-data-pipes supports a single `fhirServerUrl` as its data source. In deployments with multiple iSantePlus instances (e.g., one per facility), you'd need to run a separate pipeline per instance. This mediator presents all instances as a single FHIR endpoint.

## How It Works

```
                        ┌─────────────────┐
                        │  iSantePlus 1   │
                        │  (HUEH)         │
┌──────────────┐        ├─────────────────┤        ┌──────────────┐
│  fhir-data-  │  GET   │  iSantePlus 2   │  PUT   │              │
│  pipes       │──────> │  (La Paix)      │──────> │  HAPI FHIR   │
│  pipeline    │        ├─────────────────┤        │  (SHR)       │
│              │        │  iSantePlus 3   │        │              │
└──────────────┘        │  (OFATMA)       │        └──────────────┘
       │                ├─────────────────┤               ▲
       │                │  iSantePlus 4   │               │
       │                │  (FSC)          │               │
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
│                                      │    to SHR via OpenHIM)
└──────────────────────────────────────┘
```

1. Pipeline sends a FHIR search to the aggregator (e.g., `GET /fhir/Patient?_count=100`)
2. Aggregator fans out the request to all configured iSantePlus instances in parallel
3. Responses are merged into a single Bundle with deduplication by resource ID
4. Pipeline uses offset-based pagination (`_getpages` + `_getpagesoffset`) to fetch all pages
5. Pipeline writes the aggregated data to HAPI FHIR (SHR) through OpenHIM

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
# Health check
curl http://localhost:3000/health

# FHIR metadata
curl http://localhost:3000/fhir/metadata

# Search patients across all instances
curl http://localhost:3000/fhir/Patient?_count=20
```

## Configuration

All configuration is in `config/config.json`:

### Sources

Add or remove iSantePlus instances in the `sources` array — no code changes required:

```json
{
  "sources": [
    {
      "id": "isanteplus",
      "name": "iSantePlus HUEH",
      "baseUrl": "http://isanteplus:8080/openmrs/ws/fhir2/R4",
      "username": "admin",
      "password": "Admin123"
    },
    {
      "id": "new-facility",
      "name": "iSantePlus New Facility",
      "baseUrl": "http://isanteplus5:8080/openmrs/ws/fhir2/R4",
      "username": "admin",
      "password": "Admin123"
    }
  ]
}
```

### OpenHIM Registration

The mediator registers with OpenHIM on startup using the `mediator.api` config. It creates a channel at `/aggregated-fhir` that routes to the mediator.

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

- `cacheMaxSize`: Maximum number of pagination tokens to cache (default: 1000)
- `cacheTtlMs`: Token expiry in milliseconds (default: 1 hour)

## Pipeline Integration

Point the fhir-data-pipes pipeline at the aggregator in `application.yaml`:

```yaml
fhirdata:
  fhirServerUrl: "http://fhir-aggregator:3000/fhir"
  fhirServerUserName: ""
  fhirServerPassword: ""
```

The aggregator handles authentication to each iSantePlus instance internally.

## API

### `GET /fhir/metadata`

Returns a synthetic CapabilityStatement listing supported resource types.

### `GET /fhir/:resourceType?_count=N&_since=...`

Searches all configured sources in parallel, merges results, deduplicates by resource ID, and returns a FHIR Bundle. Supports all standard FHIR search parameters — they are passed through to each source.

If results span multiple pages, the Bundle includes a `next` link with a `_getpages` token.

### `GET /fhir?_getpages=TOKEN&_getpagesoffset=N&_count=M`

Offset-based pagination. The token maps to per-source `_getpages` tokens stored in the LRU cache. The offset and count are forwarded to each source.

### `GET /health`

Returns mediator status and configured sources.

## Deduplication

Resources are deduplicated by `resourceType/id`. This handles the common case where multiple iSantePlus instances are cloned from the same database template and share identical Practitioner, Location, and other reference data.

Resources with unique IDs across instances (Patients, Encounters, Observations) pass through without deduplication.

## Error Handling

- If a source is down or times out, the aggregator logs a warning and returns results from the remaining sources. The pipeline gets partial data rather than failing entirely.
- Expired pagination tokens return HTTP 410 Gone. The pipeline will fail and retry on the next scheduled run.

## Architecture

```
src/
  index.js          # Express server + OpenHIM registration
  routes.js         # Request routing, Bundle construction
  aggregator.js     # Fan-out, merge, deduplication, offset pagination
  pagination.js     # LRU cache for pagination state
  fhir-client.js    # HTTP client with Basic Auth for upstream sources
config/
  config.json       # Runtime config (sources, OpenHIM, pagination)
  mediator.json     # OpenHIM mediator registration metadata
```

## Known Issues

- **Empty tail pages**: When resources are heavily deduplicated (e.g., Locations cloned across all instances), the raw total from sources overestimates the actual unique count. This causes fhir-data-pipes to create more pagination segments than needed. Empty segments may produce `"Invalid bundle submitted"` errors at the sink. The data still syncs correctly — only the tail pages fail.

## License

MPL-2.0
