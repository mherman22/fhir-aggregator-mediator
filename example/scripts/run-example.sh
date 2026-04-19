#!/bin/bash

set -e  # Exit on any error

# FHIR Aggregator Mediator - Complete Example Setup
# This script sets up and runs a complete demonstration of the FHIR aggregator

echo "🚀 FHIR Aggregator Mediator - Example Setup"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_CMD=()

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

is_port_in_use() {
    local port="$1"

    if command -v lsof &> /dev/null; then
        lsof -iTCP:"$port" -sTCP:LISTEN -Pn &> /dev/null
        return $?
    fi

    if command -v ss &> /dev/null; then
        ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port"
        return $?
    fi

    if command -v netstat &> /dev/null; then
        netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
        return $?
    fi

    warning "Could not verify port $port (install lsof, ss, or netstat for port checks)"
    return 1
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        error "Docker is required but not installed"
        exit 1
    fi

    resolve_compose_command

    # Check if ports are available
    for port in 3000 8081 8082 8083; do
        if is_port_in_use "$port"; then
            error "Port $port is already in use"
            exit 1
        fi
    done

    success "Prerequisites check passed"
}

# Start the stack
start_services() {
    log "Starting FHIR servers and aggregator..."

    cd "$EXAMPLE_DIR"

    # Build and start services
    compose up -d

    log "Waiting for services to be healthy..."

    # Wait for all services to be healthy
    local max_wait=300  # 5 minutes
    local wait_time=0

    while [ $wait_time -lt $max_wait ]; do
        if compose ps | grep -q "unhealthy\|starting"; then
            echo -n "."
            sleep 10
            wait_time=$((wait_time + 10))
        else
            break
        fi
    done

    echo ""

    if [ $wait_time -ge $max_wait ]; then
        error "Services did not become healthy within $max_wait seconds"
        compose ps
        exit 1
    fi

    success "All services are healthy"
}

# Load sample data
load_data() {
    log "Loading sample data to FHIR servers..."

    if compose --profile tools run --rm data-loader; then
        success "Sample data loaded successfully"
    else
        error "Failed to load sample data"
        exit 1
    fi
}

# Run tests
run_tests() {
    log "Running aggregation tests..."

    if compose --profile tools run --rm test-client; then
        success "All tests passed"
    else
        warning "Some tests failed - check output above"
    fi
}

# Show status and URLs
show_status() {
    log "Setup complete! Services are running:"
    echo ""
    echo "📊 Service Status:"
    compose ps
    echo ""
    echo "🔗 Available URLs:"
    echo "   FHIR Aggregator:      http://localhost:3000/fhir"
    echo "   Aggregator Health:    http://localhost:3000/health"
    echo "   Aggregator Metrics:   http://localhost:3000/metrics"
    echo "   Facility A (Hospital): http://localhost:8081/fhir"
    echo "   Facility B (Clinic):   http://localhost:8082/fhir"
    echo "   Facility C (Rural):    http://localhost:8083/fhir"
    echo ""
    echo "🧪 Quick Test Commands:"
    echo "   # Get all patients from all facilities"
    echo "   curl http://localhost:3000/fhir/Patient | jq"
    echo ""
    echo "   # Check aggregator health"
    echo "   curl http://localhost:3000/health | jq"
    echo ""
    echo "   # Test pagination"
    echo '   curl "http://localhost:3000/fhir/Patient?_count=5" | jq'
    echo ""
    echo "📖 See example/README.md for more testing scenarios"
    echo ""
}

# Cleanup function
cleanup() {
    if [ "$1" = "--cleanup" ]; then
        cd "$EXAMPLE_DIR"
        log "Stopping and cleaning up services..."
        compose down -v
        success "Cleanup complete"
        exit 0
    fi
}

# Main execution
main() {
    cd "$EXAMPLE_DIR"

    # Handle cleanup flag
    cleanup "$1"

    echo "This will:"
    echo "  1. Check prerequisites (Docker, available ports)"
    echo "  2. Start 3 HAPI FHIR servers + 1 aggregator"
    echo "  3. Load sample data (patients, encounters, observations)"
    echo "  4. Run comprehensive tests"
    echo "  5. Show you how to interact with the aggregator"
    echo ""

    read -p "Continue? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi

    check_prerequisites
    start_services
    load_data
    run_tests
    show_status

    echo ""
    success "Example setup complete! Press Ctrl+C to stop services or run with --cleanup to remove everything."

    # Keep running until interrupted
    trap 'echo ""; log "Shutting down..."; compose down; exit 0' INT

    log "Monitoring logs (Ctrl+C to stop)..."
    compose logs -f fhir-aggregator
}

# Help text
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "FHIR Aggregator Example Setup Script"
    echo ""
    echo "Usage:"
    echo "  $0                 # Run complete example setup"
    echo "  $0 --cleanup       # Stop and remove all containers/volumes"
    echo "  $0 --help          # Show this help"
    echo ""
    echo "This script sets up a complete FHIR aggregator demonstration with:"
    echo "  - 3 HAPI FHIR servers (simulating different facilities)"
    echo "  - 1 FHIR aggregator mediator"
    echo "  - Sample data loading"
    echo "  - Comprehensive testing"
    echo ""
    exit 0
fi

main "$@"
