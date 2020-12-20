#!/bin/bash

PACKAGE=$1
VERSION=$2

if [[ -z "$PACKAGE" ]] || [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <package> <version>"
    exit 1
fi

for pkg in $(ls -1 packages); do
    pushd packages/$pkg
    yarn add $PACKAGE@$VERSION
    popd
done
