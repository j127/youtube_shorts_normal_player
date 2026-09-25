set shell := ["bash", "-euo", "pipefail", "-c"]

# List available recipes
default:
  @just --list

# Build both extensions into _build/
build:
  ./scripts/build.sh

# Build, then run Firefox and Chromium side by side
dev: build _run_all

# Build, then run in Firefox
dev_firefox: build _run_firefox

# Build, then run in Chromium
dev_chrome: build _run_chrome

# Build, then run on Firefox for Android (pass e.g. --android-device=<id>)
dev_mobile *args: build
  bunx web-ext run -t firefox-android --source-dir _build/firefox {{args}}

[parallel]
[private]
_run_all: _run_firefox _run_chrome

[private]
_run_firefox:
  bunx web-ext run --source-dir _build/firefox

[private]
_run_chrome:
  bunx web-ext run -t chromium --source-dir _build/chrome

# Lint the built Firefox extension with web-ext (addons-linter)
lint: build
  bunx web-ext lint --source-dir _build/firefox

# Format all files with Prettier
format:
  bunx prettier --write .

# Check formatting without writing
format_check:
  bunx prettier --check .

# Verify package.json and both manifests share one version
check_versions:
  bun scripts/version.js check

# Set the version in package.json and both manifests, e.g. `just bump_version 1.6.0`
bump_version version:
  bun scripts/version.js bump {{version}}

# Run tests
test:
  bun test

# Run every check
check: format_check check_versions test lint

# Remove build artifacts and junk files
clean:
  rm -rf _build
  ./scripts/clean.sh
