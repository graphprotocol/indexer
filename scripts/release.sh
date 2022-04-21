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
export NODE_ENV=production
rm -rf node_modules packages/*/node_modules
yarn --registry https://registry.npmjs.org/
yarn config set registry https://registry.npmjs.org/
lerna publish "$VERSION"
