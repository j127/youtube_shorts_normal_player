import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// src/background.js is a classic script (Firefox loads it as an event page,
// Chrome as a service worker), so run it in its own global scope.
const SOURCE = readFileSync(
  join(import.meta.dir, "../src/background.js"),
  "utf8"
);

// Load background.js with a stubbed extension API. Records the webRequest
// listener and every updateSessionRules() call.
function loadBackground({ namespace = "browser", failUpdates = false } = {}) {
  const updates = [];
  const warnings = [];
  let listener = null;
  let filter = null;
  let extraInfoSpec = null;

  const api = {
    declarativeNetRequest: {
      updateSessionRules: async (options) => {
        updates.push(options);
        if (failUpdates) throw new Error("rule limit reached");
      },
    },
    webRequest: {
      onHeadersReceived: {
        addListener: (fn, urlFilter, extra) => {
          listener = fn;
          filter = urlFilter;
          extraInfoSpec = extra;
        },
      },
    },
  };

  const context = {
    URL,
    console: { warn: (...args) => warnings.push(args) },
    [namespace]: api,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return {
    context,
    updates,
    warnings,
    filter,
    extraInfoSpec,
    // Fire onHeadersReceived and wait for any rule update it starts.
    respond: async (details) => {
      listener({ type: "main_frame", ...details });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    // A redirect response from url to location (absolute or relative).
    redirect: async (url, location, statusCode = 303) => {
      listener({
        url,
        statusCode,
        responseHeaders: [{ name: "location", value: location }],
        type: "main_frame",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

// The details of an onHeadersReceived event for a /watch request.
function response(statusCode, responseHeaders) {
  return {
    url: "https://www.youtube.com/watch?v=abc123",
    statusCode,
    responseHeaders,
  };
}

describe("getBouncedVideoId", () => {
  const { context } = loadBackground();

  test.each([
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123",
      "abc123",
    ],
    [
      "https://m.youtube.com/watch?v=abc-_123&si=x",
      "https://m.youtube.com/shorts/abc-_123?si=x",
      "abc-_123",
    ],
    [
      "https://youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123/",
      "abc123",
    ],
  ])("%p -> %p is a bounce of %p", (from, to, expected) => {
    expect(context.getBouncedVideoId(from, to)).toBe(expected);
  });

  test.each([
    // Our own redirect, the other way.
    [
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/watch?v=abc123",
    ],
    // Not from a watch page.
    ["https://www.youtube.com/", "https://www.youtube.com/shorts/abc123"],
    [
      "https://www.youtube.com/watch/abc123",
      "https://www.youtube.com/shorts/abc123",
    ],
    // Not to a Short.
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/watch?v=abc123&pp=x",
    ],
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/",
    ],
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/@chan/shorts",
    ],
    // Not YouTube.
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://example.com/shorts/abc123",
    ],
    [
      "https://www.youtube.com.example.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123",
    ],
    // An ID that would be unsafe in a filter.
    [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc*123",
    ],
    ["not a url", "https://www.youtube.com/shorts/abc123"],
    ["https://www.youtube.com/watch?v=abc123", undefined],
  ])("ignores %p -> %p", (from, to) => {
    expect(context.getBouncedVideoId(from, to)).toBeNull();
  });
});

describe("getRedirectUrl", () => {
  const { context } = loadBackground();
  const location = (value) => [{ name: "Location", value }];

  test.each([301, 302, 303, 307, 308])("reads a %p redirect", (status) => {
    expect(
      context.getRedirectUrl(
        response(status, location("https://www.youtube.com/shorts/abc123"))
      )
    ).toBe("https://www.youtube.com/shorts/abc123");
  });

  test("keeps YouTube's http:// Location as sent", () => {
    expect(
      context.getRedirectUrl(
        response(303, location("http://www.youtube.com/shorts/abc123"))
      )
    ).toBe("http://www.youtube.com/shorts/abc123");
  });

  test("resolves a relative Location against the request URL", () => {
    expect(
      context.getRedirectUrl(response(302, location("/shorts/abc123?si=x")))
    ).toBe("https://www.youtube.com/shorts/abc123?si=x");
  });

  test.each(["location", "LOCATION", "Location"])(
    "matches the %p header name in any case",
    (name) => {
      const headers = [
        { name: "content-type", value: "text/html" },
        { name, value: "/shorts/abc123" },
      ];
      expect(context.getRedirectUrl(response(303, headers))).toBe(
        "https://www.youtube.com/shorts/abc123"
      );
    }
  );

  test.each([200, 204, 300, 304, 404])(
    "ignores a Location on a %p response",
    (status) => {
      expect(
        context.getRedirectUrl(response(status, location("/shorts/abc123")))
      ).toBeNull();
    }
  );

  test.each([
    ["no headers", undefined],
    ["no Location header", [{ name: "content-type", value: "text/html" }]],
    ["an empty Location", location("")],
    ["a Location that isn't a URL", location("https://[::1")],
  ])("returns null for %s", (_, headers) => {
    expect(context.getRedirectUrl(response(302, headers))).toBeNull();
  });
});

describe("ruleIdFor", () => {
  const { context } = loadBackground();

  test("is stable for a video", () => {
    expect(context.ruleIdFor("abc123")).toBe(context.ruleIdFor("abc123"));
  });

  test("differs between videos, including by case", () => {
    const ids = ["abc123", "abc124", "ABC123", "zm7tGrK-bsk"].map(
      context.ruleIdFor
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("is a positive 32-bit integer", () => {
    for (const videoId of ["", "a", "zm7tGrK-bsk", "_".repeat(64)]) {
      const id = context.ruleIdFor(videoId);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(2147483646);
    }
  });
});

describe("bounceRule", () => {
  const { context } = loadBackground();
  const rule = context.bounceRule("zm7tGrK-bsk");

  test("adds the fallback parameter to the Short's URL", () => {
    expect(rule.action).toEqual({
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            addOrReplaceParams: [{ key: "ysnp_fallback", value: "1" }],
          },
        },
      },
    });
  });

  test("matches only that Short's top-level navigations", () => {
    expect(rule.id).toBe(context.ruleIdFor("zm7tGrK-bsk"));
    expect(rule.condition).toEqual({
      urlFilter: "||youtube.com/shorts/zm7tGrK-bsk^",
      isUrlFilterCaseSensitive: true,
      resourceTypes: ["main_frame"],
    });
  });

  test("sits between rules.json's redirects and its allow rule", () => {
    const rules = JSON.parse(
      readFileSync(join(import.meta.dir, "../src/rules.json"), "utf8")
    );
    const priorities = (type) =>
      rules.filter((r) => r.action.type === type).map((r) => r.priority);
    expect(rule.priority).toBeGreaterThan(Math.max(...priorities("redirect")));
    expect(rule.priority).toBeLessThan(Math.min(...priorities("allow")));
  });
});

describe("onHeadersReceived listener", () => {
  test("listens to top-level YouTube watch pages", () => {
    expect(loadBackground().filter).toEqual({
      urls: ["*://*.youtube.com/watch*"],
      types: ["main_frame"],
    });
  });

  test("asks for the response headers", () => {
    expect(loadBackground().extraInfoSpec).toEqual(["responseHeaders"]);
  });

  test("adds a session rule when YouTube sends /watch to /shorts/", async () => {
    const bg = loadBackground();
    await bg.redirect(
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123"
    );
    const rule = bg.context.bounceRule("abc123");
    expect(bg.updates).toEqual([
      { removeRuleIds: [rule.id], addRules: [rule] },
    ]);
  });

  // What YouTube sent the reporter of issue #27.
  test("handles YouTube's 303 to an http:// Short", async () => {
    const bg = loadBackground();
    await bg.redirect(
      "https://www.youtube.com/watch?v=zm7tGrK-bsk",
      "http://www.youtube.com/shorts/zm7tGrK-bsk"
    );
    expect(bg.updates).toHaveLength(1);
    expect(bg.updates[0].addRules).toEqual([
      bg.context.bounceRule("zm7tGrK-bsk"),
    ]);
  });

  test("handles a relative Location", async () => {
    const bg = loadBackground();
    await bg.redirect("https://m.youtube.com/watch?v=abc123", "/shorts/abc123");
    expect(bg.updates).toHaveLength(1);
    expect(bg.updates[0].addRules).toEqual([bg.context.bounceRule("abc123")]);
  });

  test("ignores responses that aren't redirects", async () => {
    const bg = loadBackground();
    await bg.respond(
      response(200, [{ name: "content-type", value: "text/html" }])
    );
    await bg.respond(
      response(200, [{ name: "location", value: "/shorts/abc123" }])
    );
    await bg.respond(response(200, undefined));
    expect(bg.updates).toEqual([]);
  });

  test("replaces the rule if the bounce repeats before it applies", async () => {
    const bg = loadBackground();
    for (let i = 0; i < 3; i++) {
      await bg.redirect(
        "https://www.youtube.com/watch?v=abc123",
        "https://www.youtube.com/shorts/abc123"
      );
    }
    const id = bg.context.ruleIdFor("abc123");
    expect(bg.updates).toHaveLength(3);
    for (const update of bg.updates) {
      expect(update.removeRuleIds).toEqual([id]);
      expect(update.addRules.map((r) => r.id)).toEqual([id]);
    }
  });

  test("ignores other redirects", async () => {
    const bg = loadBackground();
    await bg.redirect(
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/watch?v=abc123&pp=x"
    );
    await bg.redirect(
      "https://www.youtube.com/watch?v=abc123",
      "https://accounts.google.com/ServiceLogin"
    );
    expect(bg.updates).toEqual([]);
  });

  test("logs instead of throwing when the rule can't be added", async () => {
    const bg = loadBackground({ failUpdates: true });
    await bg.redirect(
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123"
    );
    expect(bg.updates).toHaveLength(1);
    expect(bg.warnings).toHaveLength(1);
  });

  test("works with Chrome's chrome namespace", async () => {
    const bg = loadBackground({ namespace: "chrome" });
    await bg.redirect(
      "https://www.youtube.com/watch?v=abc123",
      "https://www.youtube.com/shorts/abc123"
    );
    expect(bg.updates).toHaveLength(1);
  });
});
