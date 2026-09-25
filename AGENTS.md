## Project Overview

This is a cross-browser extension that makes YouTube Shorts open in the normal YouTube player. It rewrites Shorts links in the page, redirects Shorts requests at the network layer, and redirects any Shorts URL that still loads. The extension supports both Firefox (desktop and Android) and Chrome/Chromium using Manifest V3.

## Architecture

The extension makes Shorts (`/shorts/VIDEO_ID`) open in the normal watch player (`/watch?v=VIDEO_ID`) using three layers:

1. **DOM link rewriting** (`src/main.js`): a `MutationObserver` watches added nodes and `href` changes and rewrites Shorts anchors to the watch URL in place, so opening a Short in a new tab (middle-click, Ctrl/Cmd-click) or copying its link gives the normal player. A plain left-click doesn't use the `href`: YouTube's router navigates from its own data (`reelWatchEndpoint`), so layer 3 handles those. YouTube adds links lazily and recycles anchor nodes, which is why `href` changes are observed too. A rewritten `href` no longer contains `/shorts/`, so the mutation it triggers is ignored and there is no loop. Only YouTube hosts are rewritten (external links in descriptions can have `/shorts/` paths), and `/shorts` (the feed) and `/@channel/shorts` (channel tab) are left alone.
2. **Network-layer redirect** (`src/rules.json`): `declarativeNetRequest` rules redirect top-level (`main_frame`) `/shorts/` requests before the page loads, covering direct, typed, reloaded, and external Shorts links. Rule 1 (higher priority) handles URLs with a query string and keeps it; rule 2 handles the rest.
3. **Fallback redirect** (`src/main.js`): any remaining `/shorts/VIDEO_ID` URL is redirected with `location.replace`. The new URL is built from the target URL and keeps the target's query parameters, never the query of the page being left. It runs:
   - on initial load;
   - on YouTube's desktop SPA event `yt-navigate-start`, the earliest signal, using its `detail.url`;
   - on every `MutationObserver` batch while the page URL is a Short. This is the backstop, because `m.youtube.com` navigates to Shorts without firing `yt-navigate-start` (or any other YouTube navigation event), and the event's `detail` is undocumented and can be unreadable from a content script;
   - on `pageshow` for pages restored from the back/forward cache.

   Each target is handled once per page. A `sessionStorage` loop guard allows at most two redirects in a row of the same video, each within 10 seconds of the last, so a YouTube-side bounce from `/watch` back to `/shorts` can't reload forever.

`src/main.js` is a plain content script (not a module) injected at `document_start` on `*://*.youtube.com/*`. There is no bundler and there are no runtime dependencies: everything in `src/` ships as-is.

The toolbar popup (`src/popup.html`, `src/popup.js`) shows whether the extension has host access to YouTube and has a button that requests it. Without that access neither the content script nor the DNR rules run, and users can take it away (Firefox lets them revoke MV3 host permissions; Chrome has "Site access: On click").

### Manifests

Both manifests use Manifest V3 and share `content_scripts`, `host_permissions`, the `declarativeNetRequestWithHostAccess` permission, the `declarative_net_request` ruleset (`rules.json`), and the `action` popup (`popup.html`). Keep their versions and descriptions in sync; `scripts/manifests.test.js` checks that the shared keys match.

- **Firefox** (`manifests/firefox.json`): adds `browser_specific_settings.gecko` (extension ID, `strict_min_version` 113, `data_collection_permissions`) and `gecko_android` (`strict_min_version` 142, so AMO lists it for Firefox for Android). The data-collection key needs Firefox 140+ (Android 142+), which causes the one known `web-ext lint` warning about desktop's `strict_min_version`.
- **Chrome** (`manifests/chrome.json`): no Gecko-specific settings.

### Build

`scripts/build.sh` copies `src/*` into `_build/firefox` and `_build/chrome`, copies `manifests/<browser>.json` into each as `manifest.json`, adds `LICENSE`, and then runs `web-ext build` to zip each one into `_build/artifacts/<browser>/`. Tests are `scripts/*.test.js`, run with `bun test`. Tests for `src/` live there too, because everything in `src/` ships. `main.test.js` and `popup.test.js` run the plain scripts in a `node:vm` context with stubbed browser globals.

# Instructions

Do not read, grep, cat, or otherwise look at or edit any files or directories that are blocked by `.gitignore`.

NEVER commit code that contains AI agent attribution. Do NOT add the agent name (e.g. Claude, Generated with Claude Code, Co-Authored-By Claude) anywhere in commit messages, PR descriptions, or other Git/GitHub messages.

Git history & merges: Never rewrite or force-push shared history (especially main) unless I ask. Merge PRs with a merge commit -- don't squash, and don't rebase-merge.

Default to using Bun instead of Node.js. That means use commands like `bunx` instead of `npx`.

Write tests for all code.

The task runner is [just](https://github.com/casey/just). `just` script names should be written in `snake_case`. Requires just >= 1.42 (the `dev` recipe uses `[parallel]`). Run `just` to list recipes. Key ones: `build`, `dev`, `dev_firefox`, `dev_chrome`, `dev_mobile`, `test`, `lint`, `format`, `check` (runs format_check, check_versions, test, lint), `bump_version <x.y.z>`, `clean`. Build zips go to `_build/artifacts/{firefox,chrome}/`. Versions live in `package.json` and both `manifests/*.json`; use `just bump_version` to keep them in sync.

Bun and just are pinned in `mise.toml`; CI (`.github/workflows/ci.yml`) installs them with `jdx/mise-action` and runs `just check` on pull requests and pushes to `main`. Keep CI calling `just` recipes rather than duplicating commands in the workflow. Shell scripts (and `justfile` recipes) must run on bash 3.2, the version macOS ships as `/bin/bash`. Don't use bash 4+ features such as namerefs (`local -n`), negative array indexes, `mapfile`, associative arrays, or `${var,,}`, and remember that expanding an empty array with `"${arr[@]}"` is an unbound-variable error under `set -u` before bash 4.4.

NEVER remove comments from the code without asking. They sometimes contain important notes that are needed for later.

When writing markdown, don't wrap lines in the middle of a paragraph with single line breaks. Let the lines run their full length.

Note that `rm` and `ls` might be overriden with another bash script so you might need to type out the full paths like `/bin/rm` and `/bin/ls` to use the normal commands.

Your Turn Summary: End every substantive reply with a short bulleted list under a bold `Your turn` heading, covering only what I need to do. It goes last, after everything else in the message. Phrase each bullet as an action I take, and put any link or command I need inside the bullet. Leave out what you already did unless I have to check it. When there is nothing for me to do, say that in one bullet, such as waiting on a check to finish, so a missing list never has to be interpreted. Skip the list only on one-line conversational answers. Keep it to about five bullets. If it runs longer, the message is doing too much.
