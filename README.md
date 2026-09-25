# YouTube Shorts Normal Player Browser Extension

This is a free browser extension that plays YouTube Shorts in the normal YouTube player.

It is designed for [Brave](https://brave.com/), Chrome, and Firefox (desktop and Android).

Download pages:

- [Chrome/Brave/Chromium](https://chrome.google.com/webstore/detail/youtube-shorts-normal-pla/ojdpihjfiedojdckbmipjgoehcemgbio)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/youtube-shorts-normal-player/)

The YouTube Shorts player is annoying because you can't rewind videos, among other problems. This browser extension will automatically redirect all YouTube Shorts videos so that they play in the normal YouTube player. That will allow you to rewind the videos and view them just like any normal YouTube video.

The extension works in the background, so you don't need to pin it to the toolbar.

If Shorts stop opening in the normal player, open the browser's Extensions menu (the puzzle-piece icon next to the address bar) and click YouTube Shorts Normal Player, or click its toolbar button if you pinned it. On Firefox for Android, it's under Extensions in the browser menu. The panel that opens shows whether the extension is allowed to run on YouTube and lets you turn that back on.

## Development

Requirements:

- [Bun](https://bun.sh/) and [just](https://github.com/casey/just) (1.42 or newer). Both are pinned in `mise.toml`, so `mise install` gets the right versions.
- bash. The scripts only use bash 3.2 features, so the `/bin/bash` that comes with macOS works.

```bash
bun install
just        # list recipes
just dev    # build and run in Firefox and Chromium
just check  # format check, version check, tests, lint
```

`just build` writes the extension zips to `_build/artifacts/`.

CI (`.github/workflows/ci.yml`) runs `just check` on every pull request and on pushes to `main`.
