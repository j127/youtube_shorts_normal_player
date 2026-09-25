#!/usr/bin/env bash
set -euo pipefail

echo "Building..."

echo "Clearing _build dirs..."
rm -rf _build
mkdir -p _build/firefox _build/chrome
mkdir -p _build/artifacts/firefox _build/artifacts/chrome

echo "Copying code files..."
cp -r src/* _build/firefox
cp -r src/* _build/chrome

echo "Copying manifest files..."
cp manifests/firefox.json _build/firefox/manifest.json
cp manifests/chrome.json _build/chrome/manifest.json

echo "Copying licence..."
cp LICENSE _build/firefox
cp LICENSE _build/chrome

echo "Building Firefox version..."
bunx web-ext build --source-dir _build/firefox --artifacts-dir _build/artifacts/firefox --overwrite-dest

echo "Building Chrome version..."
bunx web-ext build --source-dir _build/chrome --artifacts-dir _build/artifacts/chrome --overwrite-dest
