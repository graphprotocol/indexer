#!/bin/bash

# Performance monitoring script for the optimized indexer agent

echo "📊 Indexer Agent Performance Monitor"
echo "=================================="

# Function to get container stats
get_container_stats() {
    local container_name="indexer-agent-opt"

    if ! docker ps | grep -q $container_name; then
        echo "❌ Container $container_name is not running"
        return 1
    fi

    echo ""
    echo "🖥️  Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" $container_name

    echo ""
    echo "🔄 Performance Metrics:"

    # Try to get performance metrics from the management API
    if command -v curl &> /dev/null; then
        echo "   Fetching metrics from management API..."

        # Cache metrics
        cache_hit_rate=$(curl -s http://localhost:18000/metrics 2>/dev/null | grep "cache_hit_rate" | tail -1 || echo "N/A")
        echo "   Cache Hit Rate: $cache_hit_rate"

        # Queue metrics
        queue_size=$(curl -s http://localhost:18000/metrics 2>/dev/null | grep "queue_size" | tail -1 || echo "N/A")
        echo "   Queue Size: $queue_size"

        # Processing rate
        allocation_rate=$(curl -s http://localhost:18000/metrics 2>/dev/null | grep "allocation_processing_rate" | tail -1 || echo "N/A")
        echo "   Allocation Processing Rate: $allocation_rate"
    else
        echo "   Install curl to fetch performance metrics"
    fi
}

# Function to show logs
show_recent_logs() {
    echo ""
    echo "📝 Recent Logs (last 20 lines):"
    docker-compose -f docker-compose.optimized.yml logs --tail=20 indexer-agent-optimized
}

# Main monitoring loop
if [ "$1" = "--watch" ]; then
    echo "Watching performance metrics (Ctrl+C to exit)..."
    while true; do
        clear
        get_container_stats
        sleep 10
    done
else
    get_container_stats
    show_recent_logs
fi
