// Background script: catches YouTube sending the normal player back to the Shorts
// player. Some signed-in accounts get this (issue #27): YouTube's server answers
// /watch?v=ID with a redirect to /shorts/ID, rules.json sends that back to /watch,
// and the browser ends the loop with a "too many redirects" error page. The loop
// guard in main.js can't help, because no page ever loads.
//
// When a /watch request is redirected to /shorts/ID, add a session rule that sends
// /shorts/ID to /shorts/ID?ysnp_fallback=1 instead of /watch. rules.json lets that
// URL through, so the Short opens in the Shorts player, and main.js sees the
// parameter, removes it from the address bar, and shows a notice.
//
// The rule is added while the loop is already running, so the browser makes a few
// more round trips before it applies, which is well under its limit of 20.
// Session rules are cleared when the browser restarts or the extension updates, so
// the video gets another chance at the normal player then.

const api = globalThis.browser ?? globalThis.chrome;

// Must match FALLBACK_PARAM in main.js and the allow rule in rules.json.
const FALLBACK_PARAM = "ysnp_fallback";

// Above the redirects in rules.json (priorities 1 and 2) and below its allow rule
// for FALLBACK_PARAM (priority 4), so the rewritten URL isn't redirected again.
const BOUNCE_RULE_PRIORITY = 3;

/**
 * @param {string} hostname - A URL's hostname.
 * @returns {boolean} True for youtube.com and its subdomains (www., m., ...).
 */
function isYouTubeHost(hostname) {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

/**
 * Check whether a redirect sends a YouTube /watch page back to a Short.
 * @param {string} fromUrl - The URL that was requested.
 * @param {string} toUrl - The URL the server redirected it to.
 * @returns {string|null} The Short's video ID, or null for any other redirect.
 */
function getBouncedVideoId(fromUrl, toUrl) {
  let from, to;
  try {
    from = new URL(fromUrl);
    to = new URL(toUrl);
  } catch {
    return null;
  }
  if (!isYouTubeHost(from.hostname) || !isYouTubeHost(to.hostname)) return null;
  if (from.pathname !== "/watch") return null;

  const match = /^\/shorts\/([\w-]+)(?:\/|$)/.exec(to.pathname);
  return match ? match[1] : null;
}

/**
 * A stable rule ID for a video, so adding its rule again replaces it instead of
 * failing. If two videos share an ID, the second one's rule replaces the first's,
 * and the first is just caught again the next time YouTube redirects it.
 * @param {string} videoId - A YouTube video ID.
 * @returns {number} An integer from 1 to 2147483646.
 */
function ruleIdFor(videoId) {
  let hash = 0;
  for (let i = 0; i < videoId.length; i++) {
    hash = (Math.imul(hash, 31) + videoId.charCodeAt(i)) | 0;
  }
  // Rule IDs must be positive 32-bit integers.
  return ((hash >>> 0) % 2147483646) + 1;
}

/**
 * The session rule that lets one Short open in the Shorts player.
 * @param {string} videoId - The Short's video ID ([\w-] characters only).
 * @returns {object} A declarativeNetRequest rule.
 */
function bounceRule(videoId) {
  return {
    id: ruleIdFor(videoId),
    priority: BOUNCE_RULE_PRIORITY,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            addOrReplaceParams: [{ key: FALLBACK_PARAM, value: "1" }],
          },
        },
      },
    },
    condition: {
      // "||" anchors to youtube.com or a subdomain, and "^" ends the ID at "/",
      // "?", or the end of the URL. A urlFilter, not a regexFilter, because
      // browsers allow far fewer regex rules. Video IDs are case-sensitive.
      urlFilter: `||youtube.com/shorts/${videoId}^`,
      isUrlFilterCaseSensitive: true,
      resourceTypes: ["main_frame"],
    },
  };
}

/**
 * Let a Short open in the Shorts player from now on in this browser session.
 * @param {string} videoId - The Short's video ID.
 */
async function addBounceRule(videoId) {
  const rule = bounceRule(videoId);
  try {
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [rule.id],
      addRules: [rule],
    });
  } catch (error) {
    console.warn("Couldn't add the Shorts player fallback rule:", error);
  }
}

// The statuses a browser follows to the Location header.
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Where a response redirects to, read from its Location header.
 * @param {object} details - The details of an onHeadersReceived event.
 * @returns {string|null} The absolute redirect URL, or null if the response
 *   isn't a redirect.
 */
function getRedirectUrl(details) {
  if (!REDIRECT_STATUS_CODES.has(details.statusCode)) return null;

  const locationHeader = details.responseHeaders?.find(
    (header) => header.name.toLowerCase() === "location"
  );

  if (!locationHeader?.value) return null;

  // Location can be relative to the requested URL.
  try {
    return new URL(locationHeader.value, details.url).href;
  } catch {
    return null;
  }
}

// Registered at the top level so the event can wake the background script.
// Inspect the response headers to detect YouTube's redirect before the
// browser follows it.
//
// Not onBeforeRedirect: Firefox doesn't report this redirect there when a
// service worker answers the page load with its navigation preload response,
// which YouTube's service worker does (issue #27). onHeadersReceived sees the
// 3xx response and its Location header in both Firefox and Chrome.
api.webRequest.onHeadersReceived.addListener(
  (details) => {
    const redirectUrl = getRedirectUrl(details);
    const videoId = redirectUrl && getBouncedVideoId(details.url, redirectUrl);
    if (videoId) addBounceRule(videoId);
  },
  { urls: ["*://*.youtube.com/watch*"], types: ["main_frame"] },
  ["responseHeaders"]
);
