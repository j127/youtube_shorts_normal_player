#!/usr/bin/env bash

# Collect a release's files in _build/release/: the Firefox and Chrome store zips
# from scripts/build.sh, renamed so they can sit side by side.
#
# There is no source zip. The extension is plain JavaScript that ships as-is
# (build.sh only copies and zips files, with no bundling or minifying), so AMO
# doesn't need the source code.
#
# Usage: scripts/release_zips.sh
# Run scripts/build.sh first (`just release_zips` does).
#
# Keep this compatible with bash 3.2, the version macOS ships as /bin/bash.

set -euo pipefail

version=$(bun -e "console.log(require('./package.json').version)")
name="youtube_shorts_normal_player-$version"
out="_build/release"

rm -rf "$out"
mkdir -p "$out"

for browser in firefox chrome; do
  cp "_build/artifacts/$browser/$name.zip" "$out/$name-$browser.zip"
done

echo "Release files in $out:"
ls -1 "$out"
