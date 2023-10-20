redirect();

document.addEventListener("yt-navigate-start", (e) => {
    console.log("yt-navigate-start event", e);
    const path = e?.detail?.url;
    redirect(path);
});

function redirect(path) {
    if (!path?.startsWith("/shorts/")) return;

    const newURL = new URL(path.origin);
    newURL.searchParams = baseURL.searchParams;
    const videoID = path.split("/shorts/")[1];
    newURL.searchParams.append("v", videoID);
    newURL.pathname = "/watch";
    window.location.replace(newURL);
}
