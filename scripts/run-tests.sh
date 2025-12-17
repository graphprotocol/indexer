#!/bin/bash
# Cleanup function to stop and remove the container
cleanup() {
    echo "Cleaning up..."
    docker stop indexer-test-db >/dev/null 2>&1
    docker rm indexer-test-db >/dev/null 2>&1
}

# Register the cleanup function to run on script exit
trap cleanup EXIT

# Start PostgreSQL container with the same configuration as CI
docker run -d \
    --name indexer-test-db \
    -e POSTGRES_DB=indexer_tests \
    -e POSTGRES_USER=testuser \
    -e POSTGRES_PASSWORD=testpass \
    -p 5432:5432 \
    postgres:13

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker exec indexer-test-db pg_isready > /dev/null 2>&1; do
    sleep 1
done
echo "PostgreSQL is ready!"

# Load environment variables from .env file
if [ -f .env ]; then
    echo "Loading .env file..."
    source .env
else
    echo "Warning: .env file not found"
fi

# Run the tests
echo "Running tests..."
POSTGRES_TEST_HOST=localhost \
POSTGRES_TEST_DATABASE=indexer_tests \
POSTGRES_TEST_USERNAME=testuser \
POSTGRES_TEST_PASSWORD=testpass \
NODE_OPTIONS="--dns-result-order=ipv4first" \
${TEST_CMD:-yarn test:ci}
