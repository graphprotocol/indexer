#!/usr/bin/env bash

set -e
set -x

VERSION="$1"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>"
  exit 1
fi

for package in packages/*; do
  pushd $package
  chan release --allow-prerelease "$VERSION" || true
  popd
done

(
  git add packages/*/CHANGELOG.md \
    && git commit -m "*: Update changelogs ahead of release"
) || true

# Publish to NPM
rm -rf node_modules packages/*/node_modules
yarn --registry https://registry.npmjs.org/
lerna publish "$VERSION"

read  -n 1 -p "[Press any key to continue releasing to the testnet registry] "

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
