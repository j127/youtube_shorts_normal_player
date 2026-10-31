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

  const api = {
    declarativeNetRequest: {
      updateSessionRules: async (options) => {
        updates.push(options);
        if (failUpdates) throw new Error("rule limit reached");
      },
    },
    webRequest: {
      onBeforeRedirect: {
        addListener: (fn, urlFilter) => {
          listener = fn;
          filter = urlFilter;
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
    // Fire onBeforeRedirect and wait for the rule update it starts.
    redirect: async (url, redirectUrl) => {
      listener({ url, redirectUrl, type: "main_frame" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
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

describe("onBeforeRedirect listener", () => {
  test("listens to top-level YouTube watch pages", () => {
    expect(loadBackground().filter).toEqual({
      urls: ["*://*.youtube.com/watch*"],
      types: ["main_frame"],
    });
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
