#!/usr/bin/env bash

# Collect a release's files in _build/release/: the Firefox and Chrome store zips
# from scripts/build.sh, renamed so they can sit side by side, plus a source zip,
# which AMO asks for with every Firefox upload.
#
# Usage: scripts/release_zips.sh [ref]
# Run scripts/build.sh first (`just release_zips` does). The source zip is
# `git archive` of ref (default HEAD): exactly the tracked files, including
# README.md's build steps, so reviewers can rebuild the same add-on.
#
# Keep this compatible with bash 3.2, the version macOS ships as /bin/bash.

set -euo pipefail

ref="${1:-HEAD}"
version=$(bun -e "console.log(require('./package.json').version)")
name="youtube_shorts_normal_player-$version"
out="_build/release"

rm -rf "$out"
mkdir -p "$out"

for browser in firefox chrome; do
  cp "_build/artifacts/$browser/$name.zip" "$out/$name-$browser.zip"
done

git archive --format=zip --prefix="$name-source/" -o "$out/$name-source.zip" "$ref"

echo "Release files in $out:"
ls -1 "$out"
