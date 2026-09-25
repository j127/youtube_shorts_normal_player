import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VERSION_FILES,
  bumpVersion,
  checkVersions,
  readVersion,
  replaceVersion,
} from "./version.js";

const manifest = (version) =>
  `{\n    "manifest_version": 3,\n    "version": "${version}",\n    "icons": { "48": "a.png" }\n}\n`;

describe("replaceVersion", () => {
  test("replaces only the version and preserves formatting", () => {
    const out = replaceVersion(manifest("1.0.0"), "2.3.4");
    expect(out).toBe(manifest("2.3.4"));
  });

  test("rejects invalid versions", () => {
    expect(() => replaceVersion(manifest("1.0.0"), "1.0")).toThrow();
    expect(() => replaceVersion(manifest("1.0.0"), "v1.0.0")).toThrow();
  });

  test("throws when there is no version field", () => {
    expect(() => replaceVersion("{}", "1.0.0")).toThrow();
  });
});

describe("readVersion", () => {
  test("reads the top-level version", () => {
    expect(readVersion(manifest("1.2.3"))).toBe("1.2.3");
  });
});

describe("checkVersions / bumpVersion", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "version-test-"));
    mkdirSync(join(root, "manifests"));
    for (const file of VERSION_FILES) {
      writeFileSync(join(root, file), manifest("1.0.0"));
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("passes when all versions match", () => {
    expect(checkVersions(root).ok).toBe(true);
  });

  test("detects a mismatch", () => {
    writeFileSync(join(root, "manifests/chrome.json"), manifest("1.0.1"));
    expect(checkVersions(root).ok).toBe(false);
  });

  test("bumps every file", () => {
    bumpVersion("1.6.0", root);
    for (const file of VERSION_FILES) {
      expect(readFileSync(join(root, file), "utf8")).toBe(manifest("1.6.0"));
    }
    expect(checkVersions(root).ok).toBe(true);
  });

  test("writes nothing when the version is invalid", () => {
    expect(() => bumpVersion("bad", root)).toThrow();
    expect(
      checkVersions(root).versions.every((v) => v.version === "1.0.0")
    ).toBe(true);
  });
});
