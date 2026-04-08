# AGENTS.md

Do not enter the `TANK/` directory or read any files that are blocked by `.gitignore`.

## Project Overview

This is a cross-browser extension that redirects YouTube Shorts URLs to the normal YouTube player. The extension supports both Firefox (Manifest v2) and Chrome/Chromium (Manifest v3).

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

The extension consists of a single content script (`src/main.js`) that:

1. Detects YouTube Shorts URLs (paths starting with `/shorts/`)
2. Extracts the video ID from the Shorts URL
3. Redirects to the normal YouTube player (`/watch?v=VIDEO_ID`)
4. Listens for YouTube's SPA navigation events (`yt-navigate-start`) to handle in-page navigation

### Manifest Differences

- **Firefox** (`manifests/firefox.json`): Uses Manifest v2 with `content_scripts` only
- **Chrome** (`manifests/chrome.json`): Uses Manifest v3 with both `content_scripts` and `host_permissions`

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
