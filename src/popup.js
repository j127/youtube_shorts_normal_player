// Toolbar popup: shows whether the extension can run on YouTube and lets the user
// grant access. Without host access nothing works (no content script, no DNR
// redirect), and users can take it away: Firefox lets them revoke MV3 host
// permissions, and Chrome has "Site access: On click".

const api = globalThis.browser ?? globalThis.chrome;

// Must match host_permissions in manifests/*.json (scripts/popup.test.js checks).
const YOUTUBE_ORIGINS = ["*://*.youtube.com/*"];

const statusEl = document.getElementById("status");
const grantButton = document.getElementById("grant");

/**
 * Show whether the extension has access to YouTube.
 * @param {boolean|null} hasAccess - null if the check failed.
 */
function render(hasAccess) {
  if (hasAccess === null) {
    statusEl.className = "warn";
    statusEl.textContent = "Couldn't check access to YouTube.";
  } else if (hasAccess) {
    statusEl.className = "ok";
    statusEl.textContent =
      "Active on YouTube. Shorts open in the normal player.";
  } else {
    statusEl.className = "warn";
    statusEl.textContent = "No access to YouTube, so Shorts aren't redirected.";
  }
  grantButton.hidden = hasAccess !== false;
}

async function refresh() {
  try {
    render(await api.permissions.contains({ origins: YOUTUBE_ORIGINS }));
  } catch {
    render(null);
  }
}

grantButton.addEventListener("click", () => {
  // Call request() directly in the click handler: Firefox only allows it while
  // handling user input. Firefox may also close the popup while its prompt is open.
  api.permissions.request({ origins: YOUTUBE_ORIGINS }).then(render, refresh);
});

document.getElementById("version").textContent =
  `Version ${api.runtime.getManifest().version}`;

refresh();
