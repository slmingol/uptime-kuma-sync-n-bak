#!/bin/bash

# Script to sync VERSION file with package.json version

PACKAGE_VERSION=$(node -p "require('./package.json').version")
echo "$PACKAGE_VERSION" > VERSION

echo "VERSION file updated to: $PACKAGE_VERSION"
