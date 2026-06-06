# AGENTS.md

Do not enter the `TANK/` directory or read any files that are blocked by `.gitignore`.

## Project Overview

This is a cross-browser extension that makes YouTube Shorts open in the normal YouTube player. It rewrites Shorts links in the page, redirects Shorts requests at the network layer, and redirects any Shorts URL that still loads. The extension supports both Firefox and Chrome/Chromium using Manifest V3.

## Build System

The project uses Bun as the package manager (switched from yarn). Build commands:

```bash
# Build extension for both browsers
./scripts/build.sh  # or: bun run build

# Development with auto-reload
bun run dev          # Runs both Firefox and Chrome in parallel
bun run dev:firefox  # Firefox only
bun run dev:chrome   # Chrome only

# Format code
bun run format
```

### Build Process

The `build.sh` script:

1. Clears `_build` directory
2. Copies `src/*` to `_build/firefox` and `_build/chrome`
3. Copies browser-specific manifests from `manifests/` to each build directory as `manifest.json`
4. Copies LICENSE to both build directories
5. Runs build scripts.

Build output structure:

- `_build/firefox/` - Firefox extension (Manifest v2)
- `_build/chrome/` - Chrome extension (Manifest v3)

## Architecture

### Core Functionality

The extension makes Shorts (`/shorts/VIDEO_ID`) open in the normal watch player (`/watch?v=VIDEO_ID`) using three layers:

1. **DOM link rewriting** (`src/main.js`): a `MutationObserver` rewrites Shorts anchor links to the watch URL in place (handling YouTube's lazily-added and recycled links), so clicking a Short goes straight to the normal player without the Shorts player flashing first.
2. **Network-layer redirect** (`src/rules.json`): a `declarativeNetRequest` rule redirects top-level `/shorts/` requests before the page loads, covering direct, typed, reloaded, and external Shorts links.
3. **Fallback redirect** (`src/main.js`): on initial load and on YouTube's SPA navigation events (`yt-navigate-start`), any remaining `/shorts/` URL is redirected to the normal player.

### Manifest Differences

Both manifests use **Manifest V3** and share `content_scripts`, `host_permissions`, the `declarativeNetRequestWithHostAccess` permission, and the `declarative_net_request` ruleset (`rules.json`).

- **Firefox** (`manifests/firefox.json`): adds `browser_specific_settings.gecko` (extension ID, `strict_min_version` 113, data-collection disclosure).
- **Chrome** (`manifests/chrome.json`): no Gecko-specific settings.

Both manifests must be kept in sync for version numbers and descriptions.

## Code Style

- Uses Prettier for formatting (4-space indentation for JS, 2-space for MD/YAML)
- LF line endings enforced via `.editorconfig`
- Double quotes for strings
- Semicolons required
- ES5 trailing commas

## Important Notes

- Version numbers are stored in both `package.json` and both manifest files - keep them synchronized
- The extension has no build-time dependencies; it's vanilla JavaScript
- The `TANK/` directory contains archived versions and Chrome Web Store artifacts - don't modify
