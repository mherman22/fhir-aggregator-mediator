# FHIR Aggregator Mediator - Example & Test Setup

This directory contains a complete example setup that demonstrates the FHIR Aggregator Mediator in action. The setup includes multiple FHIR servers with sample data and comprehensive testing tools.

## Overview

The example creates:
- **3 HAPI FHIR servers** representing different healthcare facilities
- **1 FHIR Aggregator Mediator** that combines all sources
- **Sample data loader** to populate the servers with realistic test data
- **Test client** to validate aggregation functionality

```
┌─────────────────┐    ┌─────────────────────────────────┐
│   Test Client   │───▶│     FHIR Aggregator Mediator    │
└─────────────────┘    │      (localhost:3000/fhir)      │
                       └─────┬─────────┬─────────┬─────────┘
                             │         │         │
                             ▼         ▼         ▼
                   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                   │   HAPI A    │ │   HAPI B    │ │   HAPI C    │
                   │ (Hospital)  │ │  (Clinic)   │ │ (Rural HC)  │
                   │ :8081/fhir  │ │ :8082/fhir  │ │ :8083/fhir  │
                   └─────────────┘ └─────────────┘ └─────────────┘
```

## Quick Start

### 1. Prerequisites

- Docker and Docker Compose
- 4GB+ RAM available for containers
- Ports 3000, 8081-8083 available

### 2. Start the Complete Setup

```bash
# From the example directory
docker-compose up -d

# Wait for all services to be healthy (takes ~2-3 minutes)
docker-compose ps
```

### 3. Load Sample Data

```bash
# Load sample data to all FHIR servers
docker-compose --profile tools run --rm data-loader

# Expected output: Creates patients, encounters, observations, and conditions
```

### 4. Test the Aggregation

```bash
# Run comprehensive test suite
docker-compose --profile tools run --rm test-client

# Expected output: 10 tests validating aggregator functionality
```

### 5. Manual Testing

Once everything is running, you can test manually:

```bash
# Check aggregator health
curl http://localhost:3000/health | jq

# Get patients from all facilities combined
curl http://localhost:3000/fhir/Patient | jq

# Compare with individual facilities
curl http://localhost:8081/fhir/Patient | jq  # Hospital
curl http://localhost:8082/fhir/Patient | jq  # Clinic  
curl http://localhost:8083/fhir/Patient | jq  # Rural HC

# Test pagination
curl "http://localhost:3000/fhir/Patient?_count=5" | jq
```

## What Gets Created

### Sample Data Per Facility

Each FHIR server gets populated with:

| Resource Type | Count | Description |
|---------------|-------|-------------|
| **Patient** | 10 | Patients with different demographics per facility |
| **Encounter** | 30 | 3 encounters per patient (ambulatory, emergency, inpatient) |
| **Observation** | 60 | 2 vital sign observations per encounter |
| **Condition** | 5 | Medical conditions for 50% of patients |

**Total across all facilities: 30 patients, 90 encounters, 180 observations, 15 conditions**

### Facility-Specific Data

- **Facility A (Hospital)**: Complex cases, inpatient encounters
- **Facility B (Clinic)**: Ambulatory care, routine visits  
- **Facility C (Rural HC)**: Basic care, marked as optional in config

Each facility has unique identifiers and metadata tags to demonstrate source tracking.

## Configuration Details

### Aggregator Configuration

The [config/config.json](./config/config.json) demonstrates:

```json
{
  "sources": [
    {
      "id": "facility_a_hospital",
      "name": "Facility A - General Hospital", 
      "baseUrl": "http://hapi-fhir-facility-a:8080/fhir",
      "optional": false
    },
    {
      "id": "facility_b_clinic",
      "name": "Facility B - Community Clinic",
      "baseUrl": "http://hapi-fhir-facility-b:8080/fhir", 
      "optional": false
    },
    {
      "id": "facility_c_rural",
      "name": "Facility C - Rural Health Center",
      "baseUrl": "http://hapi-fhir-facility-c:8080/fhir",
      "optional": true  // Can fail without blocking requests
    }
  ]
}
```

Key settings optimized for testing:
- Lower circuit breaker thresholds (`failureThreshold: 3`)
- Reduced timeouts for faster feedback
- Debug logging enabled

## Testing Scenarios

### Automated Test Suite

The test client validates:

1. **✅ CapabilityStatement** - Metadata aggregation
2. **✅ Health Monitoring** - Per-source health status
3. **✅ Resource Search** - Patient, Encounter, Observation, Condition searches
4. **✅ Pagination** - Multi-page result handling  
5. **✅ Concurrent Requests** - Load handling
6. **✅ Input Validation** - Error handling for invalid requests
7. **✅ Metrics Collection** - Prometheus metrics endpoint
8. **✅ Source Failure Handling** - Graceful degradation
9. **✅ Deduplication** - Removal of exact duplicates
10. **✅ Response Headers** - Aggregation metadata

### Manual Test Scenarios

#### Test Aggregation Behavior

```bash
# 1. Get all patients (should combine from 3 sources)
curl "http://localhost:3000/fhir/Patient?_count=50" | jq '.entry[].resource | {id, name: .name[0].family, source: .meta.source}'

# 2. Test pagination with small page size
curl "http://localhost:3000/fhir/Patient?_count=3" | jq '.link[] | select(.relation == "next")'

# 3. Check source failure handling (stop one facility)
docker-compose stop hapi-fhir-facility-c
curl -I http://localhost:3000/fhir/Patient  # Check X-Aggregator-Sources-Failed header

# 4. Test health monitoring
curl http://localhost:3000/health | jq '.sources[]'

# 5. Monitor metrics
curl http://localhost:3000/metrics | grep -E "(upstream_request|http_request|dedup)"
```

#### Test Performance

```bash
# Concurrent load test
for i in {1..5}; do
  curl -s "http://localhost:3000/fhir/Patient?_count=20" > /dev/null &
done
wait

# Check metrics for request latency
curl http://localhost:3000/metrics | grep http_request_duration_seconds
```

#### Test Circuit Breaker

```bash
# 1. Stop a facility to trigger circuit breaker
docker-compose stop hapi-fhir-facility-b

# 2. Make several requests to trip the circuit
for i in {1..5}; do
  curl -s http://localhost:3000/fhir/Patient > /dev/null
done

# 3. Check circuit breaker state
curl http://localhost:3000/health | jq '.sources[] | select(.id == "facility_b_clinic")'

# 4. Restart and verify recovery
docker-compose start hapi-fhir-facility-b
sleep 30
curl http://localhost:3000/health | jq '.sources[] | select(.id == "facility_b_clinic")'
```

## Cleanup

```bash
# Stop all services
docker-compose down

# Remove all data (destructive)
docker-compose down -v
```

## Troubleshooting

### Common Issues

**"Connection refused" errors**
- FHIR servers take 60-90 seconds to fully start
- Wait for all health checks to pass: `docker-compose ps`

**"No data returned"**
- Run the data loader: `docker-compose --profile tools run --rm data-loader`
- Check individual FHIR servers: `curl http://localhost:8081/fhir/Patient`

**"Aggregator not responding"**
- Check aggregator logs: `docker-compose logs fhir-aggregator`
- Verify source validation passed in startup logs

**"Some sources failed"**
- Check which sources failed: `curl http://localhost:3000/health`
- Individual source URLs:
  - Facility A: http://localhost:8081/fhir/metadata
  - Facility B: http://localhost:8082/fhir/metadata  
  - Facility C: http://localhost:8083/fhir/metadata

### Useful Commands

```bash
# View aggregator logs with correlation IDs
docker-compose logs -f fhir-aggregator | jq -r '[.time, .level, .correlationId, .msg] | @tsv'

# Monitor resource usage
docker stats

# Check FHIR server databases
docker-compose exec hapi-fhir-facility-a curl -s http://localhost:8080/fhir/metadata | jq .software.name

# Reset specific facility data
docker-compose stop hapi-fhir-facility-a
docker volume rm example_hapi-data-a
docker-compose up -d hapi-fhir-facility-a
```

## Directory Structure

```
example/
├── README.md                     # This file
├── docker-compose.yml            # Complete stack definition
├── config/
│   ├── config.json              # Aggregator runtime configuration
│   └── mediator.json            # OpenHIM mediator metadata
├── data-loader/
│   ├── package.json
│   ├── load-data.js             # Sample data generator
│   └── Dockerfile.data-loader
├── test-client/
│   ├── package.json  
│   ├── test-aggregation.js      # Comprehensive test suite
│   └── Dockerfile.test-client
└── scripts/
    ├── run-example.sh           # One-command setup
    ├── test-performance.sh      # Load testing
    └── demo.sh                  # Interactive demo
```

## Next Steps

After exploring this example:

1. **Modify the configuration** in `config/config.json` to add your real FHIR sources
2. **Scale up** using the Kubernetes manifests in `/k8s`
3. **Enable authentication** by setting `inboundAuth.enabled: true`
4. **Add monitoring** by integrating with Prometheus/Grafana
5. **Integrate with OpenHIM** for full HIE deployment

See the main [README.md](../README.md) for production deployment guidance.