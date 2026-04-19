#!/bin/bash

# Interactive FHIR Aggregator Demo Script
# Walks through key features with explanations

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

AGGREGATOR_URL="http://localhost:3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_CMD=()

# Function to wait for user input
wait_for_user() {
    echo ""
    read -p "Press Enter to continue..." -r
    echo ""
}

resolve_compose_command() {
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD=(docker-compose)
    elif docker compose version &> /dev/null; then
        COMPOSE_CMD=(docker compose)
    else
        echo -e "${RED}Error: Docker Compose is required (docker-compose or docker compose plugin)${NC}"
        exit 1
    fi
}

compose() {
    "${COMPOSE_CMD[@]}" "$@"
}

# Function to run a command with explanation
demo_command() {
    local description="$1"
    local command="$2"
    local process_output="${3:-true}"

    echo -e "${CYAN}🔍 $description${NC}"
    echo -e "${YELLOW}Command:${NC} $command"
    echo ""

    if [[ "$process_output" == "true" ]]; then
        eval "$command" | head -20
        echo -e "${BLUE}... (output truncated for readability)${NC}"
    else
        eval "$command"
    fi

    wait_for_user
}

# Function to show a section header
section_header() {
    local separator=""
    printf -v separator '=%.0s' {1..60}

    echo ""
    echo -e "${PURPLE}${separator}${NC}"
    echo -e "${PURPLE} $1${NC}"
    echo -e "${PURPLE}${separator}${NC}"
    echo ""
}

# Check if services are running
check_setup() {
    if ! curl -s "$AGGREGATOR_URL/health" > /dev/null; then
        echo -e "${RED}Error: FHIR aggregator is not running${NC}"
        echo ""
        echo "Please start the example setup first:"
        echo "  cd example"
        echo "  ./scripts/run-example.sh"
        echo ""
        exit 1
    fi
}

# Main demo
main() {
    cd "$EXAMPLE_DIR"
    resolve_compose_command

    clear
    echo -e "${GREEN}🚀 FHIR Aggregator Mediator - Interactive Demo${NC}"
    echo -e "${GREEN}===============================================${NC}"
    echo ""
    echo "This demo will walk you through the key features of the FHIR Aggregator Mediator."
    echo "It shows how multiple FHIR servers are combined into a single unified endpoint."
    echo ""
    echo "The demo uses 3 HAPI FHIR servers:"
    echo "  📋 Facility A - Hospital (port 8081)"
    echo "  🏥 Facility B - Clinic (port 8082)"
    echo "  🏡 Facility C - Rural Health Center (port 8083)"
    echo ""
    echo "All aggregated through the mediator at port 3000."

    wait_for_user

    check_setup

    # Section 1: Health Monitoring
    section_header "1. Health Monitoring & Source Status"

    echo "The aggregator monitors the health of all upstream FHIR sources."
    echo "This includes circuit breaker status, last check times, and error counts."

    demo_command \
        "Check aggregator and source health" \
        "curl -s $AGGREGATOR_URL/health | jq ."

    # Section 2: Individual Sources
    section_header "2. Individual Source Comparison"

    echo "Let's look at each source individually to understand what gets aggregated."

    demo_command \
        "Get patients from Hospital (Facility A)" \
        "curl -s http://localhost:8081/fhir/Patient?_count=5 | jq '.entry[] | .resource | {id, name: .name[0].family, source: .meta.source}'"

    demo_command \
        "Get patients from Clinic (Facility B)" \
        "curl -s http://localhost:8082/fhir/Patient?_count=5 | jq '.entry[] | .resource | {id, name: .name[0].family, source: .meta.source}'"

    demo_command \
        "Get patients from Rural Center (Facility C)" \
        "curl -s http://localhost:8083/fhir/Patient?_count=5 | jq '.entry[] | .resource | {id, name: .name[0].family, source: .meta.source}'"

    # Section 3: Aggregated Results
    section_header "3. Aggregated Results"

    echo "Now let's see how the aggregator combines all sources into a single response."
    echo "Notice how patients from all facilities appear together."

    demo_command \
        "Get patients from ALL sources via aggregator" \
        "curl -s $AGGREGATOR_URL/fhir/Patient?_count=15 | jq '.entry[] | .resource | {id, name: .name[0].family, source: .meta.source}'"

    echo "The aggregator automatically:"
    echo "  ✓ Fans out requests to all 3 sources in parallel"
    echo "  ✓ Merges the results into a single FHIR Bundle"
    echo "  ✓ Removes duplicate resources (by ID)"
    echo "  ✓ Preserves source metadata for traceability"

    wait_for_user

    # Section 4: Pagination
    section_header "4. Pagination Across Sources"

    echo "The aggregator handles pagination across multiple sources using stateless tokens."

    demo_command \
        "Get first page of patients with small page size" \
        "curl -s '$AGGREGATOR_URL/fhir/Patient?_count=3' | jq '{total, entry_count: (.entry | length), next_link: (.link[] | select(.relation == \"next\") | .url)}'"

    echo "Notice the '_getpages' token in the next URL. This encodes pagination state"
    echo "for all sources, allowing you to continue across multiple pages."

    # Section 5: Different Resource Types
    section_header "5. Multiple Resource Types"

    echo "The aggregator works with all FHIR R4 resource types."

    demo_command \
        "Search encounters across all facilities" \
        "curl -s '$AGGREGATOR_URL/fhir/Encounter?_count=8' | jq '.entry[] | .resource | {id, status, class: .class.display, patient: .subject.reference}'"

    demo_command \
        "Search observations (vital signs)" \
        "curl -s '$AGGREGATOR_URL/fhir/Observation?_count=6' | jq '.entry[] | .resource | {id, code: .code.coding[0].display, value: .valueQuantity.value, unit: .valueQuantity.unit}'"

    # Section 6: Source Failure Handling
    section_header "6. Graceful Source Failure Handling"

    echo "Let's simulate a source failure and see how the aggregator handles it."
    echo "We'll temporarily stop Facility C (marked as optional in config)."

    echo -e "${YELLOW}Stopping Facility C...${NC}"
    compose stop hapi-fhir-facility-c > /dev/null 2>&1 || true
    sleep 3

    demo_command \
        "Query patients with one source down" \
        "curl -s -I '$AGGREGATOR_URL/fhir/Patient?_count=10' | grep -E '(HTTP|X-Aggregator)'"

    echo "Notice the 'X-Aggregator-Sources-Failed' header indicating which sources failed."
    echo "The request still succeeds with data from available sources."

    demo_command \
        "Check health status with failed source" \
        "curl -s $AGGREGATOR_URL/health | jq '.sources[] | {name: .name, status: .status, circuit_breaker: .circuitBreaker.state}'"

    echo -e "${YELLOW}Restarting Facility C...${NC}"
    compose start hapi-fhir-facility-c > /dev/null 2>&1 || true
    sleep 5

    # Section 7: Performance Metrics
    section_header "7. Performance Metrics"

    echo "The aggregator exposes detailed Prometheus metrics for monitoring."

    demo_command \
        "View key performance metrics" \
        "curl -s $AGGREGATOR_URL/metrics | grep -E '(http_requests_total|upstream_request_duration|dedup_removed_total)' | head -5" \
        false

    # Section 8: Circuit Breaker in Action
    section_header "8. Circuit Breaker Pattern"

    echo "The aggregator uses circuit breakers to prevent cascading failures."
    echo "When a source fails repeatedly, its circuit opens and requests are skipped."

    demo_command \
        "Check current circuit breaker states" \
        "curl -s $AGGREGATOR_URL/health | jq '.sources[] | {id: .id, status: .status, circuit: .circuitBreaker}'"

    # Section 9: CapabilityStatement
    section_header "9. FHIR CapabilityStatement"

    echo "The aggregator provides a unified CapabilityStatement describing its capabilities."

    demo_command \
        "View FHIR capabilities" \
        "curl -s $AGGREGATOR_URL/fhir/metadata | jq '{software: .software.name, fhirVersion: .fhirVersion, resourceTypes: [.rest[0].resource[].type] | length}'"

    # Conclusion
    section_header "Demo Complete! 🎉"

    echo -e "${GREEN}You've seen the key features of the FHIR Aggregator Mediator:${NC}"
    echo ""
    echo "✓ Health monitoring and source status tracking"
    echo "✓ Parallel fan-out to multiple FHIR sources"
    echo "✓ Result merging and deduplication"
    echo "✓ Stateless pagination across sources"
    echo "✓ Graceful handling of source failures"
    echo "✓ Circuit breaker pattern for resilience"
    echo "✓ Performance metrics collection"
    echo "✓ Full FHIR R4 resource type support"
    echo ""
    echo -e "${CYAN}Next Steps:${NC}"
    echo "📖 Read the documentation: example/README.md"
    echo "🔧 Modify config: example/config/config.json"
    echo "⚡ Run performance tests: ./scripts/test-performance.sh"
    echo "🔄 Try different scenarios with your own FHIR sources"
    echo ""
    echo -e "${YELLOW}Production Deployment:${NC}"
    echo "🚢 Use Kubernetes manifests in /k8s"
    echo "🔐 Enable authentication and TLS"
    echo "📊 Integrate with monitoring (Prometheus/Grafana)"
    echo "🌊 Consider OpenHIM integration for full HIE"
    echo ""
    echo "Thanks for exploring the FHIR Aggregator Mediator!"
}

# Help text
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    echo "FHIR Aggregator Interactive Demo"
    echo ""
    echo "Usage:"
    echo "  $0        # Start interactive demo"
    echo "  $0 --help # Show this help"
    echo ""
    echo "Prerequisites:"
    echo "  - Example setup must be running (./run-example.sh)"
    echo "  - jq must be installed for JSON processing"
    echo "  - curl must be available"
    echo ""
    echo "The demo walks through key features with explanations:"
    echo "  1. Health monitoring"
    echo "  2. Individual vs aggregated results"
    echo "  3. Pagination handling"
    echo "  4. Multiple resource types"
    echo "  5. Source failure handling"
    echo "  6. Performance metrics"
    echo "  7. Circuit breaker patterns"
    echo ""
    exit 0
fi

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required for this demo${NC}"
    echo "Install jq first: brew install jq (Mac) or apt-get install jq (Ubuntu)"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is required for this demo${NC}"
    exit 1
fi

# Run the demo
main
