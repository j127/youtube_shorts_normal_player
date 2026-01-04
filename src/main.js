redirect(window.location.pathname);

document.addEventListener("yt-navigate-start", (e) => {
    const path = e?.detail?.url;
    redirect(path);
});

function extractVideoId(path) {
    return path.split("/shorts/")[1]?.split(/[/?#]/)[0];
}

function redirect(path) {
    const isShorts = path.startsWith("/shorts/");
    if (!isShorts) return;

    const newURL = new URL(window.location);
    const videoID = extractVideoId(path);
    if (!videoID) return;

    newURL.searchParams.set("v", videoID);
    newURL.pathname = "/watch";

    const destination = newURL.toString();
    console.log("redirecting to", destination);

    window.location.replace(destination);
}
