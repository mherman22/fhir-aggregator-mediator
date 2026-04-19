#!/bin/bash

# FHIR Aggregator Performance Testing Script
# Tests various load scenarios and measures performance

set -e

# Configuration
AGGREGATOR_URL="http://localhost:3000/fhir"
AGGREGATOR_BASE_URL="${AGGREGATOR_URL%/fhir}"
if [[ "$AGGREGATOR_BASE_URL" == "$AGGREGATOR_URL" ]]; then
    AGGREGATOR_BASE_URL="${AGGREGATOR_URL%/}"
fi
METRICS_URL="${AGGREGATOR_BASE_URL}/metrics"
CONCURRENT_USERS=10
TEST_DURATION=30
REQUESTS_PER_USER=50
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_CMD=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

resolve_compose_command() {
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD=(docker-compose)
    elif docker compose version &> /dev/null; then
        COMPOSE_CMD=(docker compose)
    else
        error "Docker Compose is required but not installed (docker-compose or docker compose plugin)"
        exit 1
    fi
}

compose() {
    "${COMPOSE_CMD[@]}" "$@"
}

# Check if services are running
check_services() {
    log "Checking if FHIR aggregator is running..."

    if ! curl -s "$AGGREGATOR_URL/metadata" > /dev/null; then
        error "FHIR aggregator is not responding at $AGGREGATOR_URL"
        echo "Make sure to run the example setup first:"
        echo "  ./run-example.sh"
        exit 1
    fi

    success "FHIR aggregator is responding"
}

# Simple concurrent test using curl
test_concurrent_load() {
    log "Testing concurrent load ($CONCURRENT_USERS users, $REQUESTS_PER_USER requests each)..."

    local temp_dir=$(mktemp -d)
    local start_time=$(date +%s)

    # Function to run requests for one user
    run_user_requests() {
        local user_id=$1
        local user_file="$temp_dir/user_${user_id}.log"

        for ((i=1; i<=REQUESTS_PER_USER; i++)); do
            local request_start=$(date +%s.%N)

            if curl -s -w "%{http_code},%{time_total}\n" \
                   -o /dev/null \
                   "$AGGREGATOR_URL/Patient?_count=10" >> "$user_file" 2>/dev/null; then
                echo -n "."
            else
                echo -n "x"
            fi
        done
    }

    # Start concurrent users
    for ((user=1; user<=CONCURRENT_USERS; user++)); do
        run_user_requests $user &
    done

    # Wait for all background jobs to complete
    wait
    echo ""

    local end_time=$(date +%s)
    local total_time=$((end_time - start_time))
    local total_requests=$((CONCURRENT_USERS * REQUESTS_PER_USER))

    # Analyze results
    local success_count=0
    local error_count=0
    local total_response_time=0

    for user_file in "$temp_dir"/user_*.log; do
        while IFS=',' read -r status_code response_time; do
            if [[ "$status_code" == "200" ]]; then
                success_count=$((success_count + 1))
                total_response_time=$(echo "$total_response_time + $response_time" | bc -l)
            else
                error_count=$((error_count + 1))
            fi
        done < "$user_file"
    done

    local avg_response_time="N/A"
    if (( success_count > 0 )); then
        avg_response_time=$(echo "scale=3; $total_response_time / $success_count" | bc -l)
    fi

    local requests_per_second="N/A"
    if (( total_time > 0 )); then
        requests_per_second=$(echo "scale=2; $total_requests / $total_time" | bc -l)
    fi
    local success_rate="N/A"
    if (( total_requests > 0 )); then
        success_rate=$(echo "scale=2; $success_count * 100 / $total_requests" | bc -l)
    fi

    success "Load test completed"
    echo "Results:"
    echo "  Total Requests: $total_requests"
    echo "  Successful: $success_count"
    echo "  Failed: $error_count"
    echo "  Success Rate: $success_rate%"
    echo "  Average Response Time: ${avg_response_time}s"
    echo "  Requests/Second: $requests_per_second"
    echo "  Test Duration: ${total_time}s"

    # Cleanup
    rm -rf "$temp_dir"
}

# Test different resource types
test_resource_types() {
    log "Testing performance across different resource types..."

    local resources=("Patient" "Encounter" "Observation" "Condition")

    for resource in "${resources[@]}"; do
        echo -n "  $resource: "

        local start_time=$(date +%s.%N)
        local status_code=$(curl -s -w "%{http_code}" -o /dev/null "$AGGREGATOR_URL/$resource?_count=20")
        local end_time=$(date +%s.%N)

        local response_time=$(echo "$end_time - $start_time" | bc -l)

        if [[ "$status_code" == "200" ]]; then
            printf "%.3fs ✓\n" "$response_time"
        else
            echo "Failed (HTTP $status_code) ✗"
        fi
    done
}

# Test pagination performance
test_pagination() {
    log "Testing pagination performance..."

    local page_count=0
    local total_time=0
    local next_url="$AGGREGATOR_URL/Patient?_count=5"

    while [[ -n "$next_url" ]] && [[ $page_count -lt 10 ]]; do
        local start_time=$(date +%s.%N)

        local response=$(curl -s "$next_url")
        local end_time=$(date +%s.%N)

        local page_time=$(echo "$end_time - $start_time" | bc -l)
        total_time=$(echo "$total_time + $page_time" | bc -l)
        page_count=$((page_count + 1))

        # Extract next page URL
        next_url=$(echo "$response" | jq -r '.link[]? | select(.relation == "next") | .url // empty' 2>/dev/null || echo "")

        printf "  Page %d: %.3fs\n" "$page_count" "$page_time"

        # Add small delay to avoid overwhelming the server
        sleep 0.1
    done

    local avg_page_time=$(echo "scale=3; $total_time / $page_count" | bc -l)
    success "Pagination test completed: $page_count pages, average ${avg_page_time}s per page"
}

# Monitor metrics during test
monitor_metrics() {
    log "Capturing metrics before and after load test..."

    local metrics_before=$(curl -s "$METRICS_URL" 2>/dev/null || echo "")

    if [[ -n "$metrics_before" ]]; then
        local requests_before=$(echo "$metrics_before" | grep "http_requests_total" | head -1 | awk '{print $2}' || echo "0")
        echo "  Requests before test: $requests_before"
    fi

    # Run a mini load test
    log "Running mini load test for metrics..."
    for ((i=1; i<=20; i++)); do
        curl -s "$AGGREGATOR_URL/Patient?_count=5" > /dev/null &
    done
    wait

    sleep 2  # Let metrics settle

    local metrics_after=$(curl -s "$METRICS_URL" 2>/dev/null || echo "")

    if [[ -n "$metrics_after" ]]; then
        local requests_after=$(echo "$metrics_after" | grep "http_requests_total" | head -1 | awk '{print $2}' || echo "0")
        echo "  Requests after test: $requests_after"

        # Show some key metrics
        echo "  Key metrics:"
        echo "$metrics_after" | grep -E "(http_request_duration_seconds|upstream_request_duration_seconds)" | head -3 | while read -r line; do
            echo "    $line"
        done
    fi
}

# Test with one source down
test_degraded_performance() {
    log "Testing performance with one source down..."

    # Stop facility C (marked as optional)
    compose stop hapi-fhir-facility-c 2>/dev/null || true
    sleep 5

    local start_time=$(date +%s.%N)
    local status_code=$(curl -s -w "%{http_code}" -o /dev/null "$AGGREGATOR_URL/Patient?_count=10")
    local end_time=$(date +%s.%N)

    local response_time=$(echo "$end_time - $start_time" | bc -l)

    if [[ "$status_code" == "200" ]]; then
        success "Degraded mode working: response time ${response_time}s"
    else
        warning "Degraded mode failed with HTTP $status_code"
    fi

    # Restart the service
    compose start hapi-fhir-facility-c 2>/dev/null || true
    log "Restarted facility C"
}

# Main test suite
run_performance_tests() {
    echo "🚀 FHIR Aggregator Performance Tests"
    echo "===================================="
    echo ""

    check_services
    test_resource_types
    test_pagination
    monitor_metrics
    test_concurrent_load
    test_degraded_performance

    echo ""
    success "Performance testing complete!"
    echo ""
    echo "💡 Tips for performance optimization:"
    echo "  - Increase maxConcurrentUpstreamRequests for higher throughput"
    echo "  - Tune circuit breaker thresholds based on source reliability"
    echo "  - Enable clustering for CPU-intensive workloads"
    echo "  - Monitor upstream source performance"
    echo ""
}

# Help
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    echo "FHIR Aggregator Performance Testing Script"
    echo ""
    echo "Usage:"
    echo "  $0                    # Run all performance tests"
    echo "  $0 --help            # Show this help"
    echo ""
    echo "Tests:"
    echo "  - Resource type response times"
    echo "  - Pagination performance"
    echo "  - Concurrent user load"
    echo "  - Metrics collection"
    echo "  - Degraded mode (with failed source)"
    echo ""
    echo "Prerequisites:"
    echo "  - FHIR aggregator running on localhost:3000"
    echo "  - bc (calculator) installed"
    echo "  - jq installed for JSON parsing"
    echo ""
    exit 0
fi

# Check dependencies
if ! command -v bc &> /dev/null; then
    error "bc (calculator) is required but not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    warning "jq not found - some features may not work properly"
fi

cd "$EXAMPLE_DIR"
resolve_compose_command

# Run the tests
run_performance_tests
