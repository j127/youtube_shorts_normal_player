browser.webRequest.onBeforeRequest.addListener(
    function (details) {
        const url = new URL(details.url);

        if (!url.pathname.startsWith("/shorts/")) return;

        const videoID = url.pathname.split("/shorts/")[1];
        url.searchParams.append("v", videoID);
        const newURL = new URL(url.origin);
        newURL.search = url.searchParams.toString();
        newURL.pathname = "/watch";
        const redirectUrl = newURL.toString();

        return {
            redirectUrl,
        };
    },
    {
        urls: ["*://*.youtube.com/*"],
        types: ["main_frame"],
    },
    ["blocking"]
);
