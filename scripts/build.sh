#!/usr/bin/env bash

echo "Building..."

echo "Clearing _build dirs..."
rm -rf _build
mkdir -p _build/firefox/artifacts
mkdir -p _build/chrome/artifacts

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
pushd _build/firefox
yarn build:firefox
popd

echo "Building Chrome version..."
pushd _build/chrome
yarn build:chrome
popd
