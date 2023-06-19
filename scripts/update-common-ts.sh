#!/bin/bash

VERSION=$1

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version>"
    exit 1
fi

for pkg in $(ls -1 packages); do
    pushd packages/$pkg
    yarn add @tokene-q/common-ts@$VERSION
    popd
done
