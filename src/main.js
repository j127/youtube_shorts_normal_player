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
 * Fallback redirect for the current page. Covers direct loads, links followed
 * from outside YouTube, and any anchor that wasn't rewritten in time.
 * @param {string} urlPath - The path part of the URL (e.g., "/shorts/12345")
 */
function handleRedirect(urlPath) {
    const videoId = getShortsVideoId(urlPath);
    if (!videoId) return;

    // Preserve any existing query parameters and just change the path and video ID.
    const newUrl = new URL(window.location.href);
    newUrl.pathname = "/watch";
    newUrl.searchParams.set("v", videoId);

    window.location.replace(newUrl.toString());
}

/**
 * Rewrite a single anchor's href from /shorts/ID to /watch?v=ID, in place. This
 * is what avoids the visible Shorts-player flash: the link points at the normal
 * player before the user ever clicks it.
 * @param {Element} a - A candidate anchor element.
 */
function rewriteAnchor(a) {
    const href = a.getAttribute("href");
    // Cheap reject before constructing a URL.
    if (!href || href.indexOf("/shorts/") === -1) return;

    let url;
    try {
        // Resolve against the origin so relative and absolute hrefs both work.
        url = new URL(href, window.location.origin);
    } catch {
        return;
    }

    // Only rewrite YouTube links; an external link on a YouTube page (e.g. in a
    // video description) can also have a "/shorts/" path.
    if (
        url.hostname !== "youtube.com" &&
        !url.hostname.endsWith(".youtube.com")
    ) {
        return;
    }

    const videoId = getShortsVideoId(url.pathname);
    // Leaves "/shorts" (the feed) and "/@channel/shorts" (channel tab) untouched.
    if (!videoId) return;

    url.pathname = "/watch";
    url.searchParams.set("v", videoId);

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

    if (root.matches && root.matches('a[href*="/shorts/"]'))
        rewriteAnchor(root);
    if (root.querySelectorAll) {
        root.querySelectorAll('a[href*="/shorts/"]').forEach(rewriteAnchor);
    }
}

// 1. Fallback redirect (runs as soon as the script is injected).
handleRedirect(window.location.pathname);

// 2. Listen for YouTube internal navigation. This event is fired by YouTube's own
// framework before the next page starts loading.
document.addEventListener("yt-navigate-start", (e) => {
    const url = e.detail?.url;
    if (url) handleRedirect(url);
});

// 3. Proactively rewrite Shorts links in the DOM so clicks skip the Shorts player.
// YouTube is a single-page app that streams content in lazily and recycles anchor
// nodes (virtualized lists), so we watch for both added nodes and href changes.
// A rewritten href no longer contains "/shorts/", so the attribute mutation it
// triggers is rejected by rewriteAnchor's cheap check -- no infinite loop.
const observer = new MutationObserver((mutations) => {
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
