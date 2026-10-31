#!/usr/bin/env bash

# Preflight for a release: package.json and both manifests agree on the version,
# the tag being released (if given) is v<version>, and the working tree is clean.
#
# Usage: scripts/release_check.sh [tag]
# The release workflow passes the pushed tag, e.g. v1.6.2.
#
# Keep this compatible with bash 3.2, the version macOS ships as /bin/bash.

set -euo pipefail

tag="${1:-}"

bun scripts/version.js check
version=$(bun -e "console.log(require('./package.json').version)")

if [ -n "$tag" ] && [ "$tag" != "v$version" ]; then
  echo "Tag $tag doesn't match version $version (expected v$version)" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean:" >&2
  git status --short >&2
  exit 1
fi

echo "release_check OK: version $version${tag:+, tag $tag}, clean tree"
