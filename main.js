redirect(window.location.pathname);

document.addEventListener("yt-navigate-start", (e) => {
    const path = e?.detail?.url;
    redirect(path);
});

function redirect(path) {
    const isShorts = path.startsWith("/shorts/");
    if (!isShorts) return;

    const newURL = new URL(window.location);
    newURL.searchParams = newURL.searchParams;
    const videoID = path.split("/shorts/")[1];
    newURL.searchParams.append("v", videoID);
    newURL.pathname = "/watch";

    const destination = newURL.toString();
    console.log("redirecting to", destination);

    window.location.replace(destination);
}
