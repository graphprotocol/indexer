#!/bin/bash

for pkg in $(ls -1 packages); do
    pushd packages/$pkg
    yarn add @graphprotocol/common-ts
    popd
done
