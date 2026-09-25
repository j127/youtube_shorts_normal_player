import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RULES = JSON.parse(
  readFileSync(join(import.meta.dir, "../src/rules.json"), "utf8")
);

// Apply the rules the way declarativeNetRequest does for a top-level
// navigation: the highest-priority matching rule wins. The patterns only use
// syntax that RE2 (Chrome) and JavaScript agree on, and regexSubstitution's
// \1 backreferences become JavaScript's $1.
function redirect(url) {
  const rules = [...RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of rules) {
    const re = new RegExp(rule.condition.regexFilter);
    if (re.test(url)) {
      const substitution = rule.action.redirect.regexSubstitution;
      return url.replace(re, substitution.replace(/\\(\d)/g, "$$$1"));
    }
  }
  return null;
}

describe("rules.json", () => {
  test("every rule is a main_frame regex redirect", () => {
    for (const rule of RULES) {
      expect(rule.action.type).toBe("redirect");
      expect(rule.action.redirect.regexSubstitution).toBeString();
      expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
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
