browser.webRequest.onBeforeRequest.addListener(
    function (details) {
        const url = new URL(details.url);
        if (!url.pathname.startsWith("/shorts/")) return;

        const videoID = url.pathname.split("/shorts/")[1];

        // I did it this way to ensure that if there are any existing params
        // they all get printed out correctly with the `?` and `&` in the right
        // places.
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
