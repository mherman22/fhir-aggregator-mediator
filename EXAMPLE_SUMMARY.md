# FHIR Aggregator Mediator - Example Setup Summary

I've created a comprehensive example and testing setup for the FHIR Aggregator Mediator. This demonstrates how the mediator solves the limitation in [ohs-foundation/fhir-data-pipes](https://github.com/ohs-foundation/fhir-data-pipes) where only a single FHIR source is supported.

## What Was Created

### 📁 Complete Example Environment (`/example`)

A fully functional test setup that demonstrates aggregating 3 HAPI FHIR servers through a single mediator endpoint:

```
🏥 Facility A (Hospital)     ─┐
🏥 Facility B (Clinic)       ─┤ → 🔄 FHIR Aggregator → 📊 Unified Endpoint
🏥 Facility C (Rural Center) ─┘
```

### 🛠️ Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Docker Compose Stack** | Complete infrastructure setup | [`example/docker-compose.yml`](./example/docker-compose.yml) |
| **Sample Data Loader** | Populates FHIR servers with realistic test data | [`example/data-loader/`](./example/data-loader/) |
| **Test Client** | Comprehensive test suite validating aggregation | [`example/test-client/`](./example/test-client/) |
| **Configuration** | Aggregator settings for 3 sources | [`example/config/`](./example/config/) |
| **Helper Scripts** | One-command setup and testing tools | [`example/scripts/`](./example/scripts/) |

### 🚀 Quick Start Commands

```bash
# 1. One-command setup (starts everything, loads data, runs tests)
cd example
./scripts/run-example.sh

# 2. Interactive demo (guided tour of features)
./scripts/demo.sh

# 3. Performance testing
./scripts/test-performance.sh

# 4. Manual testing
curl http://localhost:3000/fhir/Patient | jq
curl http://localhost:3000/health | jq
```

## How It Solves the fhir-data-pipes Limitation

### The Problem
[ohs-foundation/fhir-data-pipes](https://github.com/ohs-foundation/fhir-data-pipes) only supports a single `fhirServerUrl`. For multiple sources, you need separate pipeline instances:

```
❌ BEFORE: Multiple Pipelines Required
EMR A → Pipeline A → Shared FHIR Store
EMR B → Pipeline B → Shared FHIR Store  
EMR C → Pipeline C → Shared FHIR Store
```

### The Solution
The FHIR Aggregator Mediator presents multiple sources as one endpoint:

```
✅ AFTER: Single Pipeline
EMR A ─┐
EMR B ─┤ → Aggregator → Single Pipeline → Shared FHIR Store
EMR C ─┘
```

### Configuration Example

Instead of configuring fhir-data-pipes with individual sources:
```yaml
# Multiple pipeline instances needed
fhirdata:
  fhirServerUrl: "http://facility-a:8080/fhir"  # Pipeline A
  fhirServerUrl: "http://facility-b:8080/fhir"  # Pipeline B  
  fhirServerUrl: "http://facility-c:8080/fhir"  # Pipeline C
```

You configure one pipeline pointing to the aggregator:
```yaml
# Single pipeline instance
fhirdata:
  fhirServerUrl: "http://fhir-aggregator:3000/fhir"
```

## What the Example Demonstrates

### ✅ Core Aggregation Features

1. **Parallel Fan-Out** - Requests sent to all sources simultaneously
2. **Result Merging** - FHIR Bundles combined into single response
3. **Deduplication** - Identical resources (by ID) removed
4. **Pagination** - Stateless tokens work across all sources
5. **Source Tracking** - Metadata preserved for traceability

### ✅ Resilience Features

1. **Health Monitoring** - Per-source status tracking
2. **Circuit Breaker** - Failed sources automatically bypassed  
3. **Graceful Degradation** - Requests succeed with partial data
4. **Optional Sources** - Some sources can fail without blocking
5. **Retry Logic** - Automatic retries with exponential backoff

### ✅ Production Features

1. **Prometheus Metrics** - Request latency, error rates, cache hits
2. **Structured Logging** - JSON logs with correlation IDs
3. **Authentication** - Optional Basic Auth or API key protection
4. **Rate Limiting** - Configurable request throttling
5. **Clustering** - Multi-worker support for high load

## Sample Data Generated

The example creates realistic healthcare data across 3 facilities:

| Facility | Role | Patient Count | Encounters | Observations |
|----------|------|---------------|------------|-------------|
| **Facility A** | Hospital | 10 | 30 | 60 |
| **Facility B** | Clinic | 10 | 30 | 60 |  
| **Facility C** | Rural HC | 10 | 30 | 60 |
| **Total Aggregated** | | **30** | **90** | **180** |

Data includes:
- Patients with unique IDs per facility
- Encounters (ambulatory, emergency, inpatient)
- Vital sign observations (BP, heart rate, temperature)
- Medical conditions (diabetes, hypertension, COPD)

## Test Coverage

### Automated Test Suite (10 Tests)

1. ✅ **CapabilityStatement** - Metadata aggregation works
2. ✅ **Health Endpoint** - Source monitoring functional  
3. ✅ **Patient Search** - Basic aggregation working
4. ✅ **Multiple Resource Types** - Encounter, Observation, Condition
5. ✅ **Pagination** - Multi-page results handled correctly
6. ✅ **Concurrent Requests** - Load handling validates
7. ✅ **Input Validation** - Invalid requests rejected properly
8. ✅ **Metrics Collection** - Prometheus endpoints accessible
9. ✅ **Source Failure Handling** - Graceful degradation works
10. ✅ **Response Headers** - Aggregation metadata present

### Manual Testing Scenarios

- Compare individual vs aggregated results
- Test pagination across large datasets
- Simulate source failures and recovery
- Monitor performance under concurrent load
- Validate circuit breaker behavior
- Check metrics and logging output

## Example Use Cases

### 🏥 National Health Information Exchange
```
20 District Hospitals ─┐
15 Health Centers     ─┤ → Aggregator → National HIE Pipeline
5 Specialty Clinics   ─┘
```

### 🧪 Development & Testing  
```
OpenMRS Test Instance ─┐
HAPI FHIR Test       ─┤ → Aggregator → Development Pipeline  
Custom FHIR Server   ─┘
```

### 📊 Analytics Platform
```
Hospital A EMR ─┐
Hospital B EMR ─┤ → Aggregator → Analytics Pipeline → Data Lake
Hospital C EMR ─┘
```

## Architecture Validated

The example validates the full architecture described in the main README:

- ✅ Fan-out to multiple sources in parallel
- ✅ Circuit breaker pattern prevents cascading failures  
- ✅ Stateless pagination works across sources
- ✅ Health monitoring tracks source availability
- ✅ Metrics collection enables observability
- ✅ Configuration-driven source management
- ✅ Docker containerization for easy deployment
- ✅ Kubernetes manifests for production scaling

## Next Steps

After exploring the example:

1. **Adapt Configuration** - Modify `example/config/config.json` with your real FHIR sources
2. **Scale Up** - Use the `/k8s` manifests for production deployment  
3. **Enable Security** - Configure authentication and TLS for production
4. **Monitor** - Integrate Prometheus metrics with your monitoring stack
5. **Integrate** - Point your fhir-data-pipes at the aggregator endpoint

## Files Created

```
example/
├── README.md                     # Detailed setup and usage guide
├── docker-compose.yml            # Complete infrastructure stack  
├── config/
│   ├── config.json              # Aggregator configuration
│   └── mediator.json            # OpenHIM mediator metadata
├── data-loader/                 # Sample data generation
│   ├── package.json
│   ├── package-lock.json  
│   ├── load-data.js             # Creates patients, encounters, observations
│   └── Dockerfile.data-loader
├── test-client/                 # Comprehensive test suite
│   ├── package.json
│   ├── package-lock.json
│   ├── test-aggregation.js      # 10 automated tests
│   └── Dockerfile.test-client  
└── scripts/                     # Helper utilities
    ├── run-example.sh           # One-command setup  
    ├── test-performance.sh      # Load testing
    └── demo.sh                  # Interactive guided tour
```

This example provides everything needed to understand, test, and demonstrate the FHIR Aggregator Mediator's capabilities in solving the multi-source limitation of fhir-data-pipes.