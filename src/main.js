/**
 * Extract the YouTube video ID from a Shorts path.
 * @param {string} pathname - The path part of a URL (e.g., "/shorts/VIDEO_ID")
 * @returns {string|null} The video ID, or null if this is not a Shorts video URL.
 */
function getShortsVideoId(pathname) {
  if (!pathname || !pathname.startsWith("/shorts/")) return null;

  // /shorts/VIDEO_ID -> split by "/" and take index 2.
  // Use /[?#]/ to cut off any query params or fragments.
  const videoId = pathname.split("/")[2]?.split(/[?#]/)[0];
  return videoId || null;
}

/**
 * @param {string} hostname - A URL's hostname.
 * @returns {boolean} True for youtube.com and its subdomains (www., m., ...).
 */
function isYouTubeHost(hostname) {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

/**
 * Convert a Shorts URL into the normal-player URL for the same video.
 * @param {string} href - An absolute or relative URL (e.g., "/shorts/VIDEO_ID")
 * @returns {URL|null} The /watch?v=VIDEO_ID URL, or null if href is not a YouTube Shorts video.
 */
function toWatchUrl(href) {
  let url;
  try {
    // Resolve against the origin so relative and absolute hrefs both work.
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }

  // Only rewrite YouTube links; an external link on a YouTube page (e.g. in a
  // video description) can also have a "/shorts/" path.
  if (!isYouTubeHost(url.hostname)) return null;

  const videoId = getShortsVideoId(url.pathname);
  // Leaves "/shorts" (the feed) and "/@channel/shorts" (channel tab) untouched.
  if (!videoId) return null;

  // Preserve any existing query parameters and just change the path and video ID.
  url.pathname = "/watch";
  url.searchParams.set("v", videoId);
  return url;
}

// Redirect loop guard. Every /shorts/ URL gets redirected, so if YouTube ever sent
// /watch back to /shorts (it did for some accounts in 2023) the page would reload
// forever. Allow at most LOOP_MAX_REDIRECTS redirects of the same video, each within
// LOOP_WINDOW_MS of the previous one. The record lives in sessionStorage because
// every redirect loads a new page.
const LOOP_KEY = "youtubeShortsNormalPlayer:lastRedirect";
const LOOP_MAX_REDIRECTS = 2;
const LOOP_WINDOW_MS = 10000;

/**
 * Record a redirect of videoId, unless it would continue a redirect loop.
 * @param {string} videoId - The video about to be redirected to.
 * @param {number} [now] - The current time in milliseconds (for tests).
 * @returns {boolean} True if the redirect should be skipped.
 */
function isRedirectLoop(videoId, now = Date.now()) {
  let last = null;
  try {
    last = JSON.parse(window.sessionStorage.getItem(LOOP_KEY));
  } catch {
    // Storage is blocked or the record is corrupt: treat it as no history.
  }

  const isRepeat = last?.id === videoId && now - last.ts < LOOP_WINDOW_MS;
  const count = isRepeat ? (Number(last.count) || 0) + 1 : 1;
  if (count > LOOP_MAX_REDIRECTS) return true;

  try {
    window.sessionStorage.setItem(
      LOOP_KEY,
      JSON.stringify({ id: videoId, count, ts: now })
    );
  } catch {
    // Without storage there's no loop protection, but redirects still work.
  }
  return false;
}

// The last URL handleRedirect decided on. One navigation can trigger several
// checks (and the MutationObserver fires many times), so each target is handled once.
let lastTarget = null;

/**
 * Fallback redirect for the current page. Covers direct loads, links followed
 * from outside YouTube, in-app navigation, and any anchor that wasn't rewritten in time.
 * @param {string} target - The URL being opened, absolute or relative (e.g., "/shorts/12345")
 */
function handleRedirect(target) {
  const watchUrl = toWatchUrl(target);
  if (!watchUrl || watchUrl.href === lastTarget) return;
  lastTarget = watchUrl.href;

  if (isRedirectLoop(watchUrl.searchParams.get("v"))) return;
  window.location.replace(watchUrl.href);
}

/**
 * Redirect if the page is already on a Shorts URL. Just a string check unless it
 * matches, so it's cheap enough to run on every batch of DOM mutations.
 */
function redirectIfOnShorts() {
  if (window.location.pathname.startsWith("/shorts/")) {
    handleRedirect(window.location.href);
  }
}

/**
 * Rewrite a single anchor's href from /shorts/ID to /watch?v=ID, in place, so
 * middle-click, "open in new tab", and "copy link" get the normal player. A plain
 * left-click doesn't use the href (YouTube's router navigates from its own data),
 * so handleRedirect catches those.
 * @param {Element} a - A candidate anchor element.
 */
function rewriteAnchor(a) {
  const href = a.getAttribute("href");
  // Cheap reject before constructing a URL.
  if (!href || href.indexOf("/shorts/") === -1) return;

  const url = toWatchUrl(href);
  if (!url) return;

  // Preserve the original relative/absolute form to match YouTube's own markup.
  const isAbsolute = /^https?:\/\//i.test(href);
  a.setAttribute(
    "href",
    isAbsolute ? url.href : url.pathname + url.search + url.hash
  );
}

/**
 * Rewrite every Shorts anchor within a DOM subtree. The root itself may be an anchor.
 * @param {Node} root - An element or document to scan.
 */
function rewriteShortsLinks(root) {
  // Only elements (1) and documents (9) can be queried.
  if (root.nodeType !== 1 && root.nodeType !== 9) return;

  if (root.matches && root.matches('a[href*="/shorts/"]')) rewriteAnchor(root);
  if (root.querySelectorAll) {
    root.querySelectorAll('a[href*="/shorts/"]').forEach(rewriteAnchor);
  }
}

// 1. Fallback redirect (runs as soon as the script is injected).
handleRedirect(window.location.href);

// 2. Listen for YouTube internal navigation. This event is fired by YouTube's own
// framework before the next page starts loading. Only the desktop site fires it
// (m.youtube.com doesn't) and its detail is undocumented, so the URL check in the
// observer below is the backstop.
document.addEventListener("yt-navigate-start", (e) => {
  const url = e.detail?.url;
  if (typeof url === "string") handleRedirect(url);
});

// 3. Proactively rewrite Shorts links in the DOM so new tabs and copied links get
// the normal player.
// YouTube is a single-page app that streams content in lazily and recycles anchor
// nodes (virtualized lists), so we watch for both added nodes and href changes.
// A rewritten href no longer contains "/shorts/", so the attribute mutation it
// triggers is rejected by rewriteAnchor's cheap check -- no infinite loop.
const observer = new MutationObserver((mutations) => {
  // Opening a Short always changes the DOM, so this also catches navigations that
  // fire no YouTube event (m.youtube.com, or a detail we couldn't read).
  redirectIfOnShorts();

  for (const mutation of mutations) {
    if (mutation.type === "attributes") {
      if (mutation.target.nodeType === 1) rewriteAnchor(mutation.target);
    } else {
      for (const node of mutation.addedNodes) rewriteShortsLinks(node);
    }
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["href"],
});

// Sweep anything already present when the script runs.
rewriteShortsLinks(document);

// 4. A page restored from the back/forward cache isn't loaded again, so neither the
// DNR rule nor the check above sees it. It also keeps its old lastTarget, which
// would block clicking the same Short again.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  lastTarget = null;
  redirectIfOnShorts();
});
