/**
 * Service Worker (Manifest V3) to handle extension lifecycle events.
 */

chrome.runtime.onInstalled.addListener((details) => {
    // We only want to notify the user on a MAJOR version update (e.g. 1.x.x to 2.x.x)
    if (details.reason === "update") {
        const previousMajor = details.previousVersion.split(".")[0];
        const currentMajor = chrome.runtime.getManifest().version.split(".")[0];

        if (parseInt(currentMajor) > parseInt(previousMajor)) {
            // Open the local popup info page in a new tab on major update
            chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
        }
    }

    // On first install, optionally open the info page
    if (details.reason === "install") {
        // chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    }
});
