#!/usr/bin/env bash

set -e
set -x

# Publish to NPM
lerna publish

# Publish to the private NPM registry
git clone git@github.com:graphprotocol/indexer.git /tmp/indexer-publish
cd /tmp/indexer-publish
sed -i -e s@registry.npmjs.org@testnet.thegraph.com/npm-registry@g yarn.lock
sed -i -e s@registry.yarnpkg.com@testnet.thegraph.com/npm-registry@g yarn.lock
rm yarn.lock-e
npm publish --dry-run --registry https://testnet.thegraph.com/npm-registry/
