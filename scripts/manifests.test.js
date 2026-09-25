import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (name) =>
  JSON.parse(readFileSync(join(ROOT, "manifests", `${name}.json`), "utf8"));

const FIREFOX = read("firefox");
const CHROME = read("chrome");

// Everything except browser_specific_settings must match between browsers.
const SHARED_KEYS = [
  "manifest_version",
  "name",
  "version",
  "description",
  "icons",
  "action",
  "permissions",
  "host_permissions",
  "declarative_net_request",
  "content_scripts",
];

describe("manifests", () => {
  test("have the same top-level keys apart from Firefox's settings", () => {
    const { browser_specific_settings, ...firefoxRest } = FIREFOX;
    expect(Object.keys(firefoxRest).sort()).toEqual(Object.keys(CHROME).sort());
    expect(browser_specific_settings).toBeDefined();
  });

  test.each(SHARED_KEYS)("share %p", (key) => {
    expect(FIREFOX[key]).toBeDefined();
    expect(FIREFOX[key]).toEqual(CHROME[key]);
  });

  test("reference only files that exist in src/", () => {
    const files = [
      ...Object.values(CHROME.icons),
      CHROME.action.default_popup,
      ...CHROME.declarative_net_request.rule_resources.map((r) => r.path),
      ...CHROME.content_scripts.flatMap((c) => c.js),
    ];
    for (const file of files) {
      expect(existsSync(join(ROOT, "src", file))).toBe(true);
    }
  });

  test("Firefox declares desktop and Android support", () => {
    const { gecko, gecko_android } = FIREFOX.browser_specific_settings;
    expect(gecko.id).toBeString();
    expect(gecko.strict_min_version).toBeString();
    // data_collection_permissions needs Firefox for Android 142.
    expect(gecko_android.strict_min_version).toBe("142.0");
  });
});
