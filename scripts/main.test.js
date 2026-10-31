import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// src/main.js is a plain content script, not a module, so run it the way the
// browser injects it: as a classic script in its own global scope.
const SOURCE = readFileSync(join(import.meta.dir, "../src/main.js"), "utf8");

const HOME = "https://www.youtube.com/";

// A Map-backed stand-in for sessionStorage. Share one between loads to model
// the page loads of a single tab.
function createStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

// A minimal DOM element: enough for the fallback notice that main.js builds.
function createElement(tagName) {
  const el = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes: {},
    children: [],
    listeners: {},
    parent: null,
    textContent: "",
    setAttribute: (name, value) => (el.attributes[name] = String(value)),
    getAttribute: (name) => el.attributes[name] ?? null,
    addEventListener: (type, fn) => (el.listeners[type] = fn),
    append: (...nodes) => {
      for (const node of nodes) {
        node.parent = el;
        el.children.push(node);
      }
    },
    remove: () => {
      if (!el.parent) return;
      el.parent.children = el.parent.children.filter((c) => c !== el);
      el.parent = null;
    },
    attachShadow: () => (el.shadowRoot = createElement("#shadow-root")),
  };
  return el;
}

// Every element in a tree, including shadow roots.
function descendants(el) {
  const kids = [...el.children, ...(el.shadowRoot ? [el.shadowRoot] : [])];
  return kids.flatMap((kid) => [kid, ...descendants(kid)]);
}

// Just enough of window and document for main.js's top-level code. Records
// every location.replace() and exposes the listeners it registers.
function loadContentScript(
  href,
  {
    storage = createStorage(),
    readyState = "loading",
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0",
    extensionApi = { runtime: { getManifest: () => ({ version: "1.6.2" }) } },
  } = {}
) {
  let current = new URL(href);
  const replaced = [];
  const listeners = { document: {}, window: {} };
  const timers = [];
  const body = createElement("body");
  let onMutations = null;

  const context = {
    URL,
    URLSearchParams,
    sessionStorage: storage,
    location: {
      get href() {
        return current.href;
      },
      get pathname() {
        return current.pathname;
      },
      get origin() {
        return current.origin;
      },
      replace: (url) => replaced.push(String(url)),
    },
    history: {
      replaceState: (_state, _title, url) => (current = new URL(url, current)),
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    navigator: { userAgent },
    browser: extensionApi,
    addEventListener: (type, fn) => (listeners.window[type] = fn),
    document: {
      nodeType: 9,
      readyState,
      documentElement: {},
      body,
      addEventListener: (type, fn) => (listeners.document[type] = fn),
      querySelectorAll: () => [],
      createElement,
      getElementById: (id) =>
        descendants(body).find((el) => el.id === id) ?? null,
    },
    MutationObserver: class {
      constructor(callback) {
        onMutations = callback;
      }
      observe() {}
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return {
    context,
    replaced,
    timers,
    get href() {
      return current.href;
    },
    // The fallback notice, or null if it isn't on the page.
    get notice() {
      return context.document.getElementById(
        "youtube-shorts-normal-player-notice"
      );
    },
    // YouTube's router changes the URL without loading a new page.
    setUrl: (next) => (current = new URL(next, current)),
    fire: (type, detail) => listeners.document[type]({ detail }),
    domReady: () => listeners.document.DOMContentLoaded?.(),
    pageshow: (persisted) => listeners.window.pageshow({ persisted }),
    mutate: (mutations = []) => onMutations(mutations),
  };
}

// The text, links, and buttons inside the notice.
function noticeParts(notice) {
  const all = descendants(notice);
  return {
    text: all.map((el) => el.textContent).join(" "),
    links: all.filter((el) => el.tagName === "A"),
    button: all.find((el) => el.tagName === "BUTTON"),
  };
}

// A minimal element with an href attribute.
function anchor(href) {
  const attrs = { href };
  return {
    nodeType: 1,
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => (attrs[name] = value),
    matches: () => (attrs.href ?? "").includes("/shorts/"),
    querySelectorAll: () => [],
  };
}

describe("getShortsVideoId", () => {
  const { context } = loadContentScript(HOME);

  test.each([
    ["/shorts/abc123", "abc123"],
    ["/shorts/abc-_123/extra", "abc-_123"],
    ["/shorts/", null],
    ["/shorts", null],
    ["/@chan/shorts", null],
    ["/watch", null],
    ["", null],
  ])("%p -> %p", (pathname, expected) => {
    expect(context.getShortsVideoId(pathname)).toBe(expected);
  });
});

describe("toWatchUrl", () => {
  const { context } = loadContentScript(HOME);
  const watch = (href) => context.toWatchUrl(href)?.href ?? null;

  test("resolves relative URLs against the current origin", () => {
    expect(watch("/shorts/abc123")).toBe(
      "https://www.youtube.com/watch?v=abc123"
    );
  });

  test("keeps the target's own query and hash", () => {
    expect(watch("/shorts/abc123?feature=share#x")).toBe(
      "https://www.youtube.com/watch?feature=share&v=abc123#x"
    );
  });

  test("keeps the target's host", () => {
    expect(watch("https://m.youtube.com/shorts/abc123")).toBe(
      "https://m.youtube.com/watch?v=abc123"
    );
    expect(watch("https://youtube.com/shorts/abc123")).toBe(
      "https://youtube.com/watch?v=abc123"
    );
  });

  test.each([
    "https://example.com/shorts/abc123",
    "https://notyoutube.com/shorts/abc123",
    "https://www.youtube.com.example.com/shorts/abc123",
    "/shorts/",
    "/@chan/shorts/",
    "/watch?v=abc123",
    "http://[invalid",
  ])("ignores %p", (href) => {
    expect(watch(href)).toBeNull();
  });
});

describe("initial page load", () => {
  test("redirects a Short and keeps its query", () => {
    const page = loadContentScript(
      "https://www.youtube.com/shorts/abc123?feature=share"
    );
    expect(page.replaced).toEqual([
      "https://www.youtube.com/watch?feature=share&v=abc123",
    ]);
  });

  test.each([
    HOME,
    "https://www.youtube.com/watch?v=abc123",
    "https://www.youtube.com/shorts/",
    "https://www.youtube.com/@chan/shorts",
  ])("leaves %p alone", (href) => {
    expect(loadContentScript(href).replaced).toEqual([]);
  });
});

describe("yt-navigate-start (desktop SPA navigation)", () => {
  test("redirects to the target without the current page's query", () => {
    // The event can fire before YouTube updates the URL, so location still
    // holds the page being left.
    const page = loadContentScript(
      "https://www.youtube.com/results?search_query=cats"
    );
    page.fire("yt-navigate-start", { url: "/shorts/abc123" });
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  test("doesn't carry over a playlist or start time", () => {
    const page = loadContentScript(
      "https://www.youtube.com/watch?v=old&list=PL1&index=3&t=45s"
    );
    page.fire("yt-navigate-start", { url: "/shorts/abc123" });
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  test("accepts an absolute URL", () => {
    const page = loadContentScript(HOME);
    page.fire("yt-navigate-start", {
      url: "https://www.youtube.com/shorts/abc123",
    });
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  test.each([
    ["no detail", null],
    ["no url", {}],
    ["a non-string url", { url: 42 }],
    ["the Shorts feed", { url: "/shorts/" }],
    ["a watch page", { url: "/watch?v=abc123" }],
  ])("ignores %s", (_name, detail) => {
    const page = loadContentScript(HOME);
    page.fire("yt-navigate-start", detail);
    expect(page.replaced).toEqual([]);
  });
});

describe("URL check on DOM mutations", () => {
  test("redirects navigations that fire no YouTube event (m.youtube.com)", () => {
    const page = loadContentScript("https://m.youtube.com/@chan/shorts");
    page.setUrl("/shorts/abc123");
    page.mutate();
    expect(page.replaced).toEqual(["https://m.youtube.com/watch?v=abc123"]);
  });

  test("redirects when yt-navigate-start's detail can't be read", () => {
    const page = loadContentScript(HOME);
    page.fire("yt-navigate-start", null);
    page.setUrl("/shorts/abc123");
    page.mutate();
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  test("redirects only once for one navigation", () => {
    const page = loadContentScript(HOME);
    page.fire("yt-navigate-start", { url: "/shorts/abc123" });
    page.setUrl("/shorts/abc123");
    for (let i = 0; i < 5; i++) page.mutate();
    expect(page.replaced).toHaveLength(1);
  });

  test("leaves non-Shorts pages alone", () => {
    const page = loadContentScript(HOME);
    page.setUrl("/shorts/");
    page.mutate();
    page.setUrl("/watch?v=abc123");
    page.mutate();
    expect(page.replaced).toEqual([]);
  });
});

describe("pageshow (back/forward cache)", () => {
  test("redirects a restored Shorts page", () => {
    const page = loadContentScript(HOME);
    page.setUrl("/shorts/abc123");
    page.pageshow(true);
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  test("ignores a normal page load", () => {
    const page = loadContentScript(HOME);
    page.setUrl("/shorts/abc123");
    page.pageshow(false);
    expect(page.replaced).toEqual([]);
  });

  test("lets a restored page open the same Short again", () => {
    const page = loadContentScript(HOME);
    page.fire("yt-navigate-start", { url: "/shorts/abc123" });
    page.pageshow(true);
    page.fire("yt-navigate-start", { url: "/shorts/abc123" });
    expect(page.replaced).toHaveLength(2);
  });
});

describe("redirect loop guard", () => {
  const SHORT = "https://www.youtube.com/shorts/abc123";

  test("stops the third redirect of the same video in a row", () => {
    // Each redirect loads a new page, like a /watch -> /shorts bounce would.
    const storage = createStorage();
    const counts = [1, 2, 3].map(
      () => loadContentScript(SHORT, { storage }).replaced.length
    );
    expect(counts).toEqual([1, 1, 0]);
  });

  test("uses a sliding window, so slow loops are caught too", () => {
    const { context } = loadContentScript(HOME);
    expect(context.isRedirectLoop("abc", 0)).toBe(false);
    expect(context.isRedirectLoop("abc", 9000)).toBe(false);
    expect(context.isRedirectLoop("abc", 18000)).toBe(true);
  });

  test("allows the video again once the window has passed", () => {
    const { context } = loadContentScript(HOME);
    context.isRedirectLoop("abc", 0);
    context.isRedirectLoop("abc", 1000);
    expect(context.isRedirectLoop("abc", 2000)).toBe(true);
    expect(context.isRedirectLoop("abc", 11001)).toBe(false);
  });

  test("counts each video separately", () => {
    const { context } = loadContentScript(HOME);
    context.isRedirectLoop("abc", 0);
    context.isRedirectLoop("abc", 1);
    expect(context.isRedirectLoop("xyz", 2)).toBe(false);
    expect(context.isRedirectLoop("abc", 3)).toBe(false);
  });

  test("still redirects when storage is blocked", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const counts = [1, 2, 3].map(
      () => loadContentScript(SHORT, { storage: blocked }).replaced.length
    );
    expect(counts).toEqual([1, 1, 1]);
  });

  test("ignores a corrupt record", () => {
    const storage = createStorage();
    storage.setItem("youtubeShortsNormalPlayer:lastRedirect", "{not json");
    expect(loadContentScript(SHORT, { storage }).replaced).toHaveLength(1);
  });
});

describe("rewriteAnchor", () => {
  const { context } = loadContentScript(HOME);
  const rewrite = (href) => {
    const a = anchor(href);
    context.rewriteAnchor(a);
    return a.getAttribute("href");
  };

  test.each([
    ["/shorts/abc123", "/watch?v=abc123"],
    ["/shorts/abc123?feature=share#x", "/watch?feature=share&v=abc123#x"],
    [
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/watch?v=abc123",
    ],
    [
      "https://m.youtube.com/shorts/abc123",
      "https://m.youtube.com/watch?v=abc123",
    ],
  ])("rewrites %p to %p", (href, expected) => {
    expect(rewrite(href)).toBe(expected);
  });

  test.each([
    "https://example.com/shorts/abc123",
    "/shorts/",
    "/@chan/shorts",
    "/@chan/shorts/",
    "/watch?v=abc123",
  ])("leaves %p alone", (href) => {
    expect(rewrite(href)).toBe(href);
  });

  test("leaves an anchor without an href alone", () => {
    expect(rewrite(null)).toBeNull();
  });
});

describe("MutationObserver link rewriting", () => {
  test("rewrites an anchor whose href changed", () => {
    const page = loadContentScript(HOME);
    const a = anchor("/shorts/abc123");
    page.mutate([{ type: "attributes", target: a }]);
    expect(a.getAttribute("href")).toBe("/watch?v=abc123");
  });

  test("rewrites anchors inside added nodes and skips text nodes", () => {
    const page = loadContentScript(HOME);
    const inner = anchor("/shorts/abc123");
    const container = {
      nodeType: 1,
      matches: () => false,
      querySelectorAll: () => [inner],
    };
    page.mutate([
      { type: "childList", addedNodes: [{ nodeType: 3 }, container] },
    ]);
    expect(inner.getAttribute("href")).toBe("/watch?v=abc123");
  });
});

describe("Shorts player fallback (YouTube sends /watch back to /shorts/)", () => {
  const LET_THROUGH = "https://www.youtube.com/shorts/abc123?ysnp_fallback=1";

  test("leaves a Short that background.js let through on the Shorts player", () => {
    const page = loadContentScript(LET_THROUGH);
    expect(page.replaced).toEqual([]);
  });

  test("removes the fallback parameter from the address bar", () => {
    expect(loadContentScript(LET_THROUGH).href).toBe(
      "https://www.youtube.com/shorts/abc123"
    );
    expect(
      loadContentScript(
        "https://www.youtube.com/shorts/abc123?si=x&ysnp_fallback=1&t=3"
      ).href
    ).toBe("https://www.youtube.com/shorts/abc123?si=x&t=3");
  });

  test("ignores the parameter outside a Short", () => {
    const page = loadContentScript(
      "https://www.youtube.com/watch?v=abc123&ysnp_fallback=1"
    );
    expect(page.href).toContain("ysnp_fallback=1");
    page.setUrl("/shorts/xyz789");
    page.mutate();
    expect(page.replaced).toEqual(["https://www.youtube.com/watch?v=xyz789"]);
  });

  test("stops redirecting later Shorts in the same page", () => {
    const page = loadContentScript(LET_THROUGH);
    page.setUrl("/shorts/xyz789");
    page.mutate();
    page.fire("yt-navigate-start", { url: "/shorts/def456" });
    page.pageshow(true);
    expect(page.replaced).toEqual([]);
  });

  test("stops redirecting Shorts in later page loads of the tab", () => {
    const storage = createStorage();
    loadContentScript(LET_THROUGH, { storage });
    const later = loadContentScript(HOME, { storage });
    later.fire("yt-navigate-start", { url: "/shorts/xyz789" });
    expect(later.replaced).toEqual([]);
    expect(
      loadContentScript("https://www.youtube.com/shorts/xyz789", { storage })
        .replaced
    ).toEqual([]);
  });

  test("still rewrites links, so a new tab tries the normal player again", () => {
    const page = loadContentScript(LET_THROUGH);
    const a = anchor("/shorts/xyz789");
    page.mutate([{ type: "attributes", target: a }]);
    expect(a.getAttribute("href")).toBe("/watch?v=xyz789");
  });

  test("starts when the loop guard stops a bounce inside the page", () => {
    const storage = createStorage();
    const SHORT = "https://www.youtube.com/shorts/abc123";
    loadContentScript(SHORT, { storage });
    loadContentScript(SHORT, { storage });
    const third = loadContentScript(SHORT, { storage });
    expect(third.replaced).toEqual([]);
    third.domReady();
    expect(third.notice).not.toBeNull();

    // Other Shorts in the tab now stay on the Shorts player too.
    const next = loadContentScript("https://www.youtube.com/shorts/xyz789", {
      storage,
    });
    expect(next.replaced).toEqual([]);
  });

  test("doesn't affect other tabs", () => {
    loadContentScript(LET_THROUGH);
    const other = loadContentScript("https://www.youtube.com/shorts/xyz789");
    expect(other.replaced).toEqual(["https://www.youtube.com/watch?v=xyz789"]);
  });

  test("works for the page when storage is blocked", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const page = loadContentScript(LET_THROUGH, { storage: blocked });
    page.setUrl("/shorts/xyz789");
    page.mutate();
    expect(page.replaced).toEqual([]);
    page.domReady();
    expect(page.notice).not.toBeNull();
  });
});

describe("fallback notice", () => {
  const LET_THROUGH = "https://www.youtube.com/shorts/abc123?ysnp_fallback=1";

  test("waits for the page to be parsed", () => {
    const page = loadContentScript(LET_THROUGH);
    expect(page.notice).toBeNull();
    page.domReady();
    expect(page.notice).not.toBeNull();
  });

  test("shows right away if the page is already parsed", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    expect(page.notice).not.toBeNull();
  });

  test("says what happened and asks for a report", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    const { text, links } = noticeParts(page.notice);
    expect(text).toContain("YouTube Shorts Normal Player");
    expect(text).toContain("Shorts player for the account you're signed in");
    expect(text).toContain("Please report it");
    expect(links.map((a) => a.textContent)).toEqual([
      "Report it",
      "Learn more",
    ]);
    expect(links[1].href).toBe(
      "https://github.com/j127/youtube_shorts_normal_player#when-youtube-wont-allow-the-normal-player"
    );
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener");
    }
  });

  test("fills in the report form", () => {
    const page = loadContentScript(
      "https://m.youtube.com/shorts/abc123?si=share-id&ysnp_fallback=1",
      { readyState: "complete" }
    );
    const url = new URL(noticeParts(page.notice).links[0].href);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/j127/youtube_shorts_normal_player/issues/new"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "shorts-player-notice.yaml",
      // No share ID or other query parameters.
      link: "https://m.youtube.com/shorts/abc123",
      versions: "Extension 1.6.2, Firefox 159 on Windows",
    });
  });

  test("still links to the form without the extension API or a user agent", () => {
    const page = loadContentScript(LET_THROUGH, {
      readyState: "complete",
      userAgent: "",
      extensionApi: null,
    });
    const url = new URL(noticeParts(page.notice).links[0].href);
    expect(url.searchParams.get("versions")).toBe(
      "Extension unknown, Unknown browser"
    );
  });

  test("the report form exists and has the fields the link fills in", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    const url = new URL(noticeParts(page.notice).links[0].href);
    const template = readFileSync(
      join(
        import.meta.dir,
        "../.github/ISSUE_TEMPLATE",
        url.searchParams.get("template")
      ),
      "utf8"
    );
    for (const field of url.searchParams.keys()) {
      if (field !== "template") expect(template).toContain(`id: ${field}\n`);
    }
    // Reports are counted by this label.
    expect(template).toContain('labels: ["youtube-bounce"]');
  });

  test("is announced to screen readers and keeps YouTube's styles out", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    expect(page.notice.shadowRoot).toBeDefined();
    const box = descendants(page.notice).find(
      (el) => el.getAttribute("role") === "status"
    );
    expect(box).toBeDefined();
    expect(noticeParts(page.notice).button.getAttribute("aria-label")).toBe(
      "Close"
    );
  });

  test("closes with its button", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    noticeParts(page.notice).button.listeners.click();
    expect(page.notice).toBeNull();
  });

  test("closes itself after 30 seconds", () => {
    const page = loadContentScript(LET_THROUGH, { readyState: "complete" });
    expect(page.timers.map((t) => t.ms)).toEqual([30000]);
    page.timers[0].fn();
    expect(page.notice).toBeNull();
  });

  test("shows once per tab", () => {
    const storage = createStorage();
    const first = loadContentScript(LET_THROUGH, {
      storage,
      readyState: "complete",
    });
    first.setUrl("/shorts/xyz789");
    first.mutate();
    expect(first.context.document.body.children).toEqual([first.notice]);

    const second = loadContentScript(
      "https://www.youtube.com/shorts/def456?ysnp_fallback=1",
      { storage, readyState: "complete" }
    );
    expect(second.notice).toBeNull();
  });

  test("isn't shown when the normal player works", () => {
    const page = loadContentScript("https://www.youtube.com/shorts/abc123", {
      readyState: "complete",
    });
    page.fire("yt-navigate-start", { url: "/shorts/xyz789" });
    expect(page.notice).toBeNull();
  });
});

describe("describeBrowser", () => {
  const { context } = loadContentScript(HOME);

  test.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0",
      "Firefox 159 on Windows",
    ],
    [
      "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
      "Firefox 142 on Android",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Chrome 141 on macOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      "Chrome 141 on Android",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "Edge 141 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0",
      "Opera 125 on Linux",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Chrome 141 on ChromeOS",
    ],
    ["Something/1.0", "Unknown browser"],
    [undefined, "Unknown browser"],
  ])("%p -> %p", (userAgent, expected) => {
    expect(context.describeBrowser(userAgent)).toBe(expected);
  });
});
