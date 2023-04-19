browser.webRequest.onBeforeRequest.addListener(
    function (details) {
        const url = new URL(details.url);

        if (!url.pathname.startsWith("/shorts/")) return;

        const videoID = url.pathname.split("/shorts/")[1];

        const newURL = new URL(url.origin);
        newURL.searchParams = url.searchParams;
        newURL.searchParams.append("v", videoID);
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
