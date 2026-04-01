#!/bin/bash
set -e

# Usage: ./release.sh [patch|minor|major]
# Default: patch
#
# Example:
#   ./release.sh         → 1.0.0-SNAPSHOT → 1.0.0 (release) → 1.0.1-SNAPSHOT
#   ./release.sh minor   → 1.0.0-SNAPSHOT → 1.0.0 (release) → 1.1.0-SNAPSHOT
#   ./release.sh major   → 1.0.0-SNAPSHOT → 1.0.0 (release) → 2.0.0-SNAPSHOT

BUMP_TYPE="${1:-patch}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo "Usage: ./release.sh [patch|minor|major]"
  exit 1
fi

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Ensure we're on main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "Error: Must be on main branch (currently on $BRANCH)"
  exit 1
fi

git pull origin main

# Get current snapshot version and strip -SNAPSHOT
CURRENT=$(node -p "require('./package.json').version")
RELEASE_VERSION="${CURRENT%-SNAPSHOT}"

if [ "$CURRENT" = "$RELEASE_VERSION" ]; then
  echo "Error: Current version ($CURRENT) is not a SNAPSHOT. Already released?"
  exit 1
fi

echo "Releasing v${RELEASE_VERSION}..."

# 1. Set release version
node -e "
const pkg = require('./package.json');
pkg.version = '${RELEASE_VERSION}';
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
git add package.json
git commit -m "Release v${RELEASE_VERSION}"
git tag -a "v${RELEASE_VERSION}" -m "Release v${RELEASE_VERSION}"

# 2. Calculate next snapshot version
NEXT_VERSION=$(node -e "
const [major, minor, patch] = '${RELEASE_VERSION}'.split('.').map(Number);
if ('${BUMP_TYPE}' === 'major') console.log((major+1) + '.0.0-SNAPSHOT');
else if ('${BUMP_TYPE}' === 'minor') console.log(major + '.' + (minor+1) + '.0-SNAPSHOT');
else console.log(major + '.' + minor + '.' + (patch+1) + '-SNAPSHOT');
")

node -e "
const pkg = require('./package.json');
pkg.version = '${NEXT_VERSION}';
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
git add package.json
git commit -m "Prepare for next development iteration: ${NEXT_VERSION}"

# 3. Push everything
git push origin main --tags

echo ""
echo "Done!"
echo "  Released: v${RELEASE_VERSION}"
echo "  Next dev: ${NEXT_VERSION}"
echo "  Image:    ghcr.io/mherman22/fhir-aggregator-mediator:${RELEASE_VERSION}"
echo ""
echo "GitHub Release will be created automatically by CI."
echo "  Check: https://github.com/mherman22/fhir-aggregator-mediator/actions"
