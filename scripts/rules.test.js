import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const read = (path) => readFileSync(join(import.meta.dir, "..", path), "utf8");

const RULES = JSON.parse(read("src/rules.json"));
const REDIRECTS = RULES.filter((r) => r.action.type === "redirect");
const ALLOWS = RULES.filter((r) => r.action.type === "allow");

// background.js's session rule for a bounced Short. Load the script with just
// enough of an extension API for its top-level listener registration.
function bounceRule(videoId) {
  const noop = { addListener() {} };
  const context = { URL, browser: { webRequest: { onHeadersReceived: noop } } };
  vm.createContext(context);
  vm.runInContext(read("src/background.js"), context);
  return context.bounceRule(videoId);
}

// declarativeNetRequest's urlFilter syntax as a JavaScript regex, for the parts
// background.js uses: "||" (domain or subdomain anchor) and "^" (a separator or
// the end of the URL).
function urlFilterToRegExp({ urlFilter, isUrlFilterCaseSensitive }) {
  let source = "";
  let rest = urlFilter;
  if (rest.startsWith("||")) {
    source += "^[a-z]+://(?:[^/?#]*\\.)?";
    rest = rest.slice(2);
  }
  for (const char of rest) {
    source +=
      char === "^"
        ? "(?:[^\\w.%-]|$)"
        : char.replace(/[.*+?${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(source, isUrlFilterCaseSensitive ? "" : "i");
}

const matches = (rule, url) =>
  rule.condition.regexFilter
    ? new RegExp(rule.condition.regexFilter).test(url)
    : urlFilterToRegExp(rule.condition).test(url);

// Apply rules the way declarativeNetRequest does for a top-level navigation:
// the highest-priority matching rule wins. The regex patterns only use syntax
// that RE2 (Chrome) and JavaScript agree on, and regexSubstitution's \1
// backreferences become JavaScript's $1. Returns the redirect URL, or null if
// the request goes through unchanged.
function redirect(url, rules = RULES) {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const rule = sorted.find((r) => matches(r, url));
  if (!rule || rule.action.type === "allow") return null;

  const { regexSubstitution, transform } = rule.action.redirect;
  if (regexSubstitution) {
    const re = new RegExp(rule.condition.regexFilter);
    return url.replace(re, regexSubstitution.replace(/\\(\d)/g, "$$$1"));
  }
  const next = new URL(url);
  for (const { key, value } of transform.queryTransform.addOrReplaceParams) {
    next.searchParams.set(key, value);
  }
  return next.href;
}

// Follow a navigation through the extension's rules and a YouTube server that
// sends watch pages back to /shorts/ (issue #27), like the browser does, up to
// its redirect limit. Returns the URL that loads, or null if the loop never ends.
function navigate(url, rules) {
  for (let hops = 0; hops < 20; hops++) {
    const next = redirect(url, rules);
    if (next) {
      url = next;
      continue;
    }
    const page = new URL(url);
    if (page.pathname !== "/watch") return url;
    url = `${page.origin}/shorts/${page.searchParams.get("v")}`;
  }
  return null;
}

describe("rules.json", () => {
  test("has the two redirects and the fallback allow rule", () => {
    expect(REDIRECTS).toHaveLength(2);
    expect(ALLOWS).toHaveLength(1);
  });

  test("every rule is a main_frame regex rule", () => {
    for (const rule of RULES) {
      expect(rule.condition.regexFilter).toBeString();
      expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
    }
    for (const rule of REDIRECTS) {
      expect(rule.action.redirect.regexSubstitution).toBeString();
    }
  });

  test("rule IDs and priorities are unique", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(new Set(RULES.map((r) => r.priority)).size).toBe(RULES.length);
  });

  test("patterns avoid syntax RE2 doesn't support (lookaround, backreferences)", () => {
    for (const rule of RULES) {
      expect(rule.condition.regexFilter).not.toMatch(/\(\?[=!<]|\\[1-9]/);
    }
  });

  test("the fallback parameter matches background.js and main.js", () => {
    const param = /const FALLBACK_PARAM = "([^"]+)";/;
    const name = read("src/background.js").match(param)[1];
    expect(read("src/main.js").match(param)[1]).toBe(name);
    expect(ALLOWS[0].condition.regexFilter).toContain(`${name}=1`);
  });
});

describe("redirects", () => {
  test.each([
    [
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/watch?v=abc123",
    ],
    [
      "https://www.youtube.com/shorts/abc-_123?feature=share&si=x",
      "https://www.youtube.com/watch?v=abc-_123&feature=share&si=x",
    ],
    [
      "https://m.youtube.com/shorts/abc123",
      "https://m.youtube.com/watch?v=abc123",
    ],
    ["https://youtube.com/shorts/abc123", "https://youtube.com/watch?v=abc123"],
    [
      "https://www.youtube.com/shorts/abc123/",
      "https://www.youtube.com/watch?v=abc123",
    ],
    [
      "https://www.youtube.com/shorts/abc123?",
      "https://www.youtube.com/watch?v=abc123",
    ],
  ])("%p -> %p", (url, expected) => {
    expect(redirect(url)).toBe(expected);
  });

  test.each([
    "https://www.youtube.com/shorts/",
    "https://www.youtube.com/shorts",
    "https://www.youtube.com/@chan/shorts",
    "https://www.youtube.com/watch?v=abc123",
    "https://www.youtube.com/feed/subscriptions",
  ])("leaves %p alone", (url) => {
    expect(redirect(url)).toBeNull();
  });
});

describe("fallback allow rule", () => {
  test.each([
    "https://www.youtube.com/shorts/abc123?ysnp_fallback=1",
    "https://m.youtube.com/shorts/abc123?si=x&ysnp_fallback=1",
    "https://www.youtube.com/shorts/abc123?ysnp_fallback=1&si=x",
    "https://www.youtube.com/shorts/abc123/?ysnp_fallback=1",
  ])("lets %p through", (url) => {
    expect(redirect(url)).toBeNull();
  });

  test.each([
    "https://www.youtube.com/shorts/abc123?ysnp_fallback=10",
    "https://www.youtube.com/shorts/abc123?xysnp_fallback=1",
    "https://www.youtube.com/shorts/abc123?ysnp_fallback=0",
    "https://www.youtube.com/shorts/abc123#ysnp_fallback=1",
  ])("still redirects %p", (url) => {
    expect(redirect(url)).toStartWith("https://www.youtube.com/watch?v=abc123");
  });
});

describe("background.js's bounce rule", () => {
  const rules = [...RULES, bounceRule("abc123")];

  test.each([
    [
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/shorts/abc123?ysnp_fallback=1",
    ],
    [
      "https://m.youtube.com/shorts/abc123?si=x",
      "https://m.youtube.com/shorts/abc123?si=x&ysnp_fallback=1",
    ],
    [
      "https://youtube.com/shorts/abc123/",
      "https://youtube.com/shorts/abc123/?ysnp_fallback=1",
    ],
  ])("sends %p to %p", (url, expected) => {
    expect(redirect(url, rules)).toBe(expected);
  });

  test.each([
    "https://www.youtube.com/shorts/abc1234",
    "https://www.youtube.com/shorts/abc123-x",
    "https://www.youtube.com/shorts/ABC123",
    "https://example.com/shorts/abc123",
  ])("leaves other Shorts to the normal redirects: %p", (url) => {
    expect(redirect(url, rules)).not.toContain("ysnp_fallback");
  });

  test("lets its own result through", () => {
    const url = redirect("https://www.youtube.com/shorts/abc123", rules);
    expect(redirect(url, rules)).toBeNull();
  });
});

describe("when YouTube sends /watch back to /shorts/", () => {
  const SHORT = "https://www.youtube.com/shorts/abc123?si=x";

  test("the redirects alone loop until the browser gives up", () => {
    expect(navigate(SHORT, RULES)).toBeNull();
  });

  test("the bounce rule ends the loop on the Shorts player", () => {
    const rules = [...RULES, bounceRule("abc123")];
    expect(navigate(SHORT, rules)).toBe(
      "https://www.youtube.com/shorts/abc123?si=x&ysnp_fallback=1"
    );
    expect(navigate("https://www.youtube.com/watch?v=abc123", rules)).toBe(
      "https://www.youtube.com/shorts/abc123?ysnp_fallback=1"
    );
  });
});
