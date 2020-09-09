#!/usr/bin/env bash

set -e
set -x

# Publish to NPM
rm -rf node_modules packages/*/node_modules
yarn --registry https://registry.npmjs.org/
lerna publish

# Publish to testnet NPM registry
git clone git@github.com:graphprotocol/indexer.git /tmp/indexer-release
pushd /tmp/indexer-release
(
  rm yarn.lock
  yarn --registry https://testnet.thegraph.com/npm-registry/
  for package in packages/*; do
    pushd $package
    npm publish --registry https://testnet.thegraph.com/npm-registry/
    popd
  done
)
popd
rm -rf /tmp/indexer-release
