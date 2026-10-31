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

// Shorts player fallback. For some signed-in accounts YouTube sends /watch back to
// /shorts/ on its server (issue #27). background.js catches that and lets the Short
// load with FALLBACK_PARAM added, and the loop guard above catches a bounce that
// happens inside the page. Either way the tab is marked, so later Shorts in it open
// in the Shorts player without a reload, and a notice says why. The mark lasts for
// the tab's session: a new tab tries the normal player again.
// Must match FALLBACK_PARAM in background.js and the allow rule in rules.json.
const FALLBACK_PARAM = "ysnp_fallback";
const FALLBACK_KEY = "youtubeShortsNormalPlayer:fallback";
const NOTICE_KEY = "youtubeShortsNormalPlayer:noticeShown";
const NOTICE_ID = "youtube-shorts-normal-player-notice";
// Long enough to read it and decide whether to report it.
const NOTICE_TIMEOUT_MS = 30000;
const HELP_URL =
  "https://github.com/j127/youtube_shorts_normal_player#when-youtube-wont-allow-the-normal-player";
// The owner wants every affected user to report it, to see how widespread it is.
// The issue form's labels count the reports. Its `link` and `versions` field ids
// must match the query parameters set in reportUrl().
const REPORT_URL =
  "https://github.com/j127/youtube_shorts_normal_player/issues/new";
const REPORT_TEMPLATE = "shorts-player-notice.yaml";

// In-memory copies, for when sessionStorage is blocked.
let fallbackActive = false;
let noticeShown = false;

/**
 * @param {string} key - A sessionStorage key.
 * @returns {string|null} The stored value, or null if missing or storage is blocked.
 */
function readSession(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key - A sessionStorage key.
 * @param {string} value - The value to store. Ignored if storage is blocked.
 */
function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // The in-memory copy still covers this page.
  }
}

/**
 * @returns {boolean} True if YouTube refused the normal player earlier in this tab.
 */
function isFallbackActive() {
  return fallbackActive || readSession(FALLBACK_KEY) === "1";
}

/**
 * Remember that YouTube refuses the normal player in this tab, and say so.
 */
function activateFallback() {
  fallbackActive = true;
  writeSession(FALLBACK_KEY, "1");
  showFallbackNotice();
}

/**
 * Remove FALLBACK_PARAM from the address bar, so a copied link doesn't carry it.
 * @returns {boolean} True if the page is a Short that background.js let through.
 */
function takeFallbackParam() {
  const url = new URL(window.location.href);
  if (
    !getShortsVideoId(url.pathname) ||
    !url.searchParams.has(FALLBACK_PARAM)
  ) {
    return false;
  }
  url.searchParams.delete(FALLBACK_PARAM);
  try {
    // A page that was just redirected here has no history state yet.
    window.history.replaceState(null, "", url.href);
  } catch {
    // The parameter stays in the address bar, which is harmless.
  }
  return true;
}

/**
 * Show the notice once per tab session. It waits for <body>, because this
 * script runs before the page is parsed.
 */
function showFallbackNotice() {
  if (noticeShown || readSession(NOTICE_KEY) === "1") return;
  noticeShown = true;
  writeSession(NOTICE_KEY, "1");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFallbackNotice, {
      once: true,
    });
  } else {
    renderFallbackNotice();
  }
}

/**
 * Name the browser and OS from a user agent string, for the report form.
 * Brave reports itself as Chrome.
 * @param {string} [userAgent] - navigator.userAgent.
 * @returns {string} For example "Firefox 159 on Windows".
 */
function describeBrowser(userAgent = "") {
  // Edge and Opera also contain "Chrome/", so check them first.
  const browsers = [
    ["Firefox", "Firefox"],
    ["Edg", "Edge"],
    ["OPR", "Opera"],
    ["Chrome", "Chrome"],
  ];
  let browser = "Unknown browser";
  for (const [token, name] of browsers) {
    const match = new RegExp(`${token}/(\\d+)`).exec(userAgent);
    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }

  // Android user agents can also contain "Linux", so check it first.
  const systems = [
    [/Android/, "Android"],
    [/iPhone|iPad/, "iOS"],
    [/Windows/, "Windows"],
    [/CrOS/, "ChromeOS"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ];
  const system = systems.find(([pattern]) => pattern.test(userAgent));
  return system ? `${browser} on ${system[1]}` : browser;
}

/**
 * The issue form for reporting the fallback, filled in with what the extension
 * knows. The Short's query string (e.g. a share ID) is left out.
 * @returns {string} A github.com URL.
 */
function reportUrl() {
  let version = "unknown";
  try {
    version = (globalThis.browser ?? globalThis.chrome).runtime.getManifest()
      .version;
  } catch {
    // Leave it as "unknown"; the reporter can fill it in.
  }
  const params = new URLSearchParams({
    template: REPORT_TEMPLATE,
    link: window.location.origin + window.location.pathname,
    versions: `Extension ${version}, ${describeBrowser(window.navigator?.userAgent)}`,
  });
  return `${REPORT_URL}?${params}`;
}

const NOTICE_CSS = `
  .notice {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 2147483647;
    box-sizing: border-box;
    width: max-content;
    max-width: min(440px, calc(100vw - 32px));
    padding: 12px 40px 12px 16px;
    border-radius: 12px;
    background: #212121;
    color: #fff;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
    font: 14px/1.4 Roboto, Arial, sans-serif;
  }
  @media (max-width: 600px) {
    /* Clear m.youtube.com's bottom navigation bar. */
    .notice { bottom: 72px; }
  }
  p { margin: 0 0 6px; }
  strong { font-weight: 500; }
  a { color: #3ea6ff; }
  .links {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 10px 0 0;
  }
  .report {
    padding: 6px 14px;
    border-radius: 18px;
    background: #3ea6ff;
    color: #0f0f0f;
    font-weight: 500;
    text-decoration: none;
  }
  .report:hover { background: #65b8ff; }
  button {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font: 20px/28px Arial, sans-serif;
    cursor: pointer;
  }
  button:hover { background: rgb(255 255 255 / 0.15); }
`;

/**
 * @param {string} href - Where the link goes.
 * @param {string} text - The link text.
 * @returns {HTMLAnchorElement} A link that opens in a new tab.
 */
function newTabLink(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = text;
  return link;
}

/**
 * Add the notice to the page. It lives in a shadow root so YouTube's styles
 * don't reach it, and it closes itself after NOTICE_TIMEOUT_MS.
 */
function renderFallbackNotice() {
  if (document.getElementById(NOTICE_ID)) return;

  const host = document.createElement("div");
  host.id = NOTICE_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = NOTICE_CSS;

  const box = document.createElement("div");
  box.className = "notice";
  box.setAttribute("role", "status");

  const title = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = "YouTube Shorts Normal Player";
  title.append(strong);

  const message = document.createElement("p");
  message.textContent =
    "YouTube keeps sending this Short back to the Shorts player for the account " +
    "you're signed in with, so it can't open in the normal player. It looks like " +
    "a YouTube test on some accounts. Please report it so we can see how many " +
    "people it affects.";

  const links = document.createElement("p");
  links.className = "links";
  const report = newTabLink(reportUrl(), "Report it");
  report.className = "report";
  links.append(report, newTabLink(HELP_URL, "Learn more"));

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", () => host.remove());

  box.append(title, message, links, close);
  root.append(style, box);
  (document.body ?? document.documentElement).append(host);
  setTimeout(() => host.remove(), NOTICE_TIMEOUT_MS);
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

  // YouTube sends this tab's Shorts back to the Shorts player, so redirecting
  // would only reload the page.
  if (isFallbackActive()) {
    showFallbackNotice();
    return;
  }
  if (isRedirectLoop(watchUrl.searchParams.get("v"))) {
    activateFallback();
    return;
  }
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

// 0. A Short that background.js let through because YouTube refused the normal
// player for it.
if (takeFallbackParam()) activateFallback();

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
