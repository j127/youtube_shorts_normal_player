/**
 * Highly efficient redirect for YouTube Shorts to the standard watch player.
 * @param {string} urlPath - The path part of the URL (e.g., "/shorts/12345")
 */
function handleRedirect(urlPath) {
    // Fast path check
    if (!urlPath || !urlPath.startsWith("/shorts/")) return;

    // Extract the video ID. /shorts/VIDEO_ID -> split by / and take index 2.
    // Use /[?#]/ regex to cut off any query params or fragments.
    const videoId = urlPath.split("/")[2]?.split(/[?#]/)[0];
    if (!videoId) return;

    // Preserve any existing query parameters and just change the video ID and path.
    const newUrl = new URL(window.location.href);
    newUrl.pathname = "/watch";
    newUrl.searchParams.set("v", videoId);

    // console.log("Redirecting to normal player:", videoId);
    window.location.replace(newUrl.toString());
}

// 1. Initial check (runs as soon as the script is injected)
handleRedirect(window.location.pathname);

// 2. Listen for YouTube internal navigation
// This event is fired by YouTube's own framework before the next page starts loading.
document.addEventListener("yt-navigate-start", (e) => {
    const url = e.detail?.url;
    if (url) handleRedirect(url);
});
