# YouTube Shorts Normal Player Browser Extension

This is a free browser extension that plays YouTube Shorts in the normal YouTube player.

It is designed for [Brave](https://brave.com/), Chrome, and Firefox (desktop and Android).

Download pages:

- [Chrome/Brave/Chromium](https://chrome.google.com/webstore/detail/youtube-shorts-normal-pla/ojdpihjfiedojdckbmipjgoehcemgbio)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/youtube-shorts-normal-player/)

The YouTube Shorts player is annoying because you can't rewind videos, among other problems. This browser extension will automatically redirect all YouTube Shorts videos so that they play in the normal YouTube player. That will allow you to rewind the videos and view them just like any normal YouTube video.

The extension works in the background, so you don't need to pin it to the toolbar.

If Shorts stop opening in the normal player, open the browser's Extensions menu (the puzzle-piece icon next to the address bar) and click YouTube Shorts Normal Player, or click its toolbar button if you pinned it. On Firefox for Android, it's under Extensions in the browser menu. The panel that opens shows whether the extension is allowed to run on YouTube and lets you turn that back on.

## When YouTube won't allow the normal player

For some signed-in accounts, YouTube sends every Short back to the Shorts player when it's opened in the normal player. It looks like something YouTube is testing on some accounts: the same Shorts open in the normal player when you're signed out or signed in with a different account. Redirecting again would only loop, so the extension lets the Short open in the Shorts player and shows a notice explaining why. Shorts in that tab then stay in the Shorts player, and a new tab tries the normal player again. Until YouTube stops doing this, signing out of YouTube (or using a private window) is the only way to get the normal player for those Shorts.

There is no setting to change, but please report it: each report helps show how many accounts YouTube is doing this to. The notice's **Report it** button opens [this form](https://github.com/j127/youtube_shorts_normal_player/issues/new?template=shorts-player-notice.yaml) with the details filled in, and every question on it is optional. It needs a free GitHub account. Background is in [issue #27](https://github.com/j127/youtube_shorts_normal_player/issues/27).

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
