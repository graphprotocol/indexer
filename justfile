# Build the indexer-agent and indexer-cli images locally.
# Defaults to tagging `ghcr.io/graphprotocol/{indexer-agent,indexer-cli}:local`.
# Override the tag with: `just build-image sha-abc1234`
build-image tag="local":
    TAG={{tag}} docker compose build
