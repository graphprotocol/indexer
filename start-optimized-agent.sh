#!/bin/bash

set -e

echo "🚀 Starting Optimized Indexer Agent..."

# Validate required environment variables
required_vars=(
    "ETHEREUM"
    "MNEMONIC"
    "INDEXER_ADDRESS"
    "GRAPH_NODE_QUERY_ENDPOINT"
    "GRAPH_NODE_STATUS_ENDPOINT"
    "GRAPH_NODE_ADMIN_ENDPOINT"
    "PUBLIC_INDEXER_URL"
    "POSTGRES_HOST"
    "POSTGRES_DATABASE"
    "NETWORK_SUBGRAPH_ENDPOINT"
    "EPOCH_SUBGRAPH_ENDPOINT"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: Required environment variable $var is not set"
        echo "Please set all required variables in your environment or .env file"
        exit 1
    fi
done

echo "✅ Environment validation passed"

# Start with optimized settings
docker-compose -f docker-compose.optimized.yml up -d

echo "🎉 Optimized Indexer Agent started successfully!"
echo ""
echo "📊 Monitoring URLs:"
echo "   Management API: http://localhost:18000"
echo "   Metrics: http://localhost:19090/metrics"
echo ""
echo "📈 Performance Features Enabled:"
echo "   • Parallel allocation processing (concurrency: $ALLOCATION_CONCURRENCY)"
echo "   • Intelligent caching (TTL: ${CACHE_TTL}ms)"
echo "   • Circuit breaker for resilience"
echo "   • Priority-based task scheduling"
echo "   • Batch query optimization"
echo ""
echo "🔍 View logs with: docker-compose -f docker-compose.optimized.yml logs -f"
echo "⏹️  Stop with: docker-compose -f docker-compose.optimized.yml down"
