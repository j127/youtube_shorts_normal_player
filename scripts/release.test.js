import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const VERSION_FILES = [
  "package.json",
  "manifests/firefox.json",
  "manifests/chrome.json",
];

// /bin/bash is bash 3.2 on macOS; the scripts have to work there too.
const SHELLS = ["bash", "/bin/bash"].filter(
  (shell) => shell === "bash" || existsSync(shell)
);

function run(cmd, cwd) {
  const result = Bun.spawnSync(cmd, { cwd, stderr: "pipe", stdout: "pipe" });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function git(cwd, ...args) {
  const result = run(["git", ...args], cwd);
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function write(root, file, text) {
  mkdirSync(join(root, dirname(file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

function setVersion(root, file, version) {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

// A throwaway git repo with the release scripts, version.js, and the three
// version files at `version`, all committed.
function createRepo(version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "release-test-"));
  for (const file of [
    "scripts/release_check.sh",
    "scripts/release_zips.sh",
    "scripts/version.js",
    ...VERSION_FILES,
  ]) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
  for (const file of VERSION_FILES) setVersion(root, file, version);
  write(root, ".gitignore", "_build/\n");
  write(root, "src/main.js", "// content script\n");

  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

describe.each(SHELLS)("release_check.sh with %s", (shell) => {
  let root;
  const check = (...args) =>
    run([shell, "scripts/release_check.sh", ...args], root);

  beforeEach(() => (root = createRepo("1.2.3")));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("passes with matching versions and a clean tree", () => {
    const result = check();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("release_check OK: version 1.2.3");
  });

  test("passes when the tag matches the version", () => {
    const result = check("v1.2.3");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("tag v1.2.3");
  });

  test.each(["v1.2.4", "1.2.3", "v1.2.3-beta"])(
    "fails when the tag is %p",
    (tag) => {
      const result = check(tag);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("expected v1.2.3");
    }
  );

  test("fails when the versions disagree", () => {
    setVersion(root, "manifests/chrome.json", "1.2.4");
    git(root, "commit", "-q", "-am", "skew");
    const result = check("v1.2.3");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Version mismatch");
  });

  test("fails with uncommitted changes", () => {
    write(root, "src/main.js", "// edited\n");
    const result = check("v1.2.3");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Working tree is not clean");
    expect(result.stderr).toContain("src/main.js");
  });

  test("fails with untracked files", () => {
    write(root, "notes.txt", "");
    expect(check().code).toBe(1);
  });

  test("ignores build output", () => {
    write(root, "_build/artifacts/firefox/x.zip", "");
    expect(check().code).toBe(0);
  });
});

describe.each(SHELLS)("release_zips.sh with %s", (shell) => {
  let root;
  const NAME = "youtube_shorts_normal_player-1.2.3";
  const zips = () => run([shell, "scripts/release_zips.sh"], root);
  const release = (file = "") => join(root, "_build/release", file);

  beforeEach(() => {
    root = createRepo("1.2.3");
    // What scripts/build.sh leaves behind: one zip per browser, same name.
    write(root, `_build/artifacts/firefox/${NAME}.zip`, "firefox");
    write(root, `_build/artifacts/chrome/${NAME}.zip`, "chrome");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("names the store zips by browser", () => {
    expect(zips().code).toBe(0);
    expect(readdirSync(release()).sort()).toEqual([
      `${NAME}-chrome.zip`,
      `${NAME}-firefox.zip`,
      `${NAME}-source.zip`,
    ]);
    expect(readFileSync(release(`${NAME}-firefox.zip`), "utf8")).toBe(
      "firefox"
    );
    expect(readFileSync(release(`${NAME}-chrome.zip`), "utf8")).toBe("chrome");
  });

  test("makes the source zip from tracked files only", () => {
    write(root, "untracked.txt", "");
    expect(zips().code).toBe(0);
    const listing = run(["unzip", "-Z1", release(`${NAME}-source.zip`)], root);
    const files = listing.stdout.trim().split("\n");
    expect(files).toContain(`${NAME}-source/src/main.js`);
    expect(files).toContain(`${NAME}-source/package.json`);
    expect(files.every((f) => f.startsWith(`${NAME}-source/`))).toBe(true);
    expect(files.some((f) => f.includes("untracked.txt"))).toBe(false);
    expect(files.some((f) => f.includes("_build"))).toBe(false);
  });

  test("replaces files from an earlier run", () => {
    write(
      root,
      "_build/release/youtube_shorts_normal_player-1.0.0-firefox.zip",
      ""
    );
    expect(zips().code).toBe(0);
    expect(readdirSync(release())).toHaveLength(3);
  });

  test("fails if the build hasn't run", () => {
    rmSync(join(root, "_build"), { recursive: true });
    expect(zips().code).not.toBe(0);
  });
});

describe("release workflow", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")
  );
  const ci = Bun.YAML.parse(
    readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")
  );
  const steps = workflow.jobs.release.steps;
  const runs = steps.map((s) => s.run).filter(Boolean);

  test("runs on version tags only", () => {
    expect(workflow.on).toEqual({
      push: { tags: ["v[0-9]+.[0-9]+.[0-9]+"] },
    });
  });

  test("can write releases and nothing else", () => {
    expect(workflow.permissions).toEqual({ contents: "write" });
  });

  test("uses the same pinned actions as CI", () => {
    const uses = (job) => job.steps.map((s) => s.uses).filter(Boolean);
    expect(uses(workflow.jobs.release)).toEqual(uses(ci.jobs.check));
    for (const action of uses(workflow.jobs.release)) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  test("checks, then packages, through just recipes", () => {
    expect(runs.slice(0, 4)).toEqual([
      "bun install --frozen-lockfile",
      "just check",
      'just release_check "$GITHUB_REF_NAME"',
      "just release_zips",
    ]);
  });

  test("creates a draft release with the three zips", () => {
    const create = runs.at(-1);
    expect(create).toStartWith(
      'gh release create "$GITHUB_REF_NAME" _build/release/*.zip'
    );
    expect(create).toContain("--draft");
    expect(create).toContain("--verify-tag");
    expect(steps.at(-1).env).toEqual({ GH_TOKEN: "${{ github.token }}" });
  });

  test("the just recipes it calls exist", () => {
    const justfile = readFileSync(join(ROOT, "justfile"), "utf8");
    expect(justfile).toMatch(/^release_check tag="":$/m);
    expect(justfile).toMatch(/^release_zips: build$/m);
  });
});
