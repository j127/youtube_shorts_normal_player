import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "clean.sh");

const JUNK = [
  ".DS_Store",
  "Thumbs.db",
  "notes.txt~",
  "a b/.DS_Store",
  "src/.DS_Store",
  "src/mod.pyc",
  "src/mod.pyo",
  "src/__pycache__/mod.cpython-313.pyc",
  "node_modules/.cache/prettier/.prettier-cache",
];

const KEEP = [
  "src/main.js",
  "a b/keep.txt",
  ".claude/.DS_Store",
  ".git/.DS_Store",
  ".worktrees/wt/.DS_Store",
  "node_modules/pkg/.DS_Store",
  "node_modules/pkg/__pycache__/x.pyc",
  "TANK/.DS_Store",
];

// /bin/bash is bash 3.2 on macOS; the script has to work there too.
const SHELLS = ["bash", "/bin/bash"].filter(
  (shell) => shell === "bash" || existsSync(shell)
);

describe.each(SHELLS)("clean.sh with %s", (shell) => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "clean-test-"));
    for (const file of [...JUNK, ...KEEP]) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      writeFileSync(join(root, file), "");
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = () =>
    Bun.spawnSync([shell, SCRIPT], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

  test("exits cleanly", () => {
    const result = run();
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("deletes junk files and directories", () => {
    run();
    for (const file of JUNK) expect(existsSync(join(root, file))).toBe(false);
    expect(existsSync(join(root, "src/__pycache__"))).toBe(false);
  });

  test("keeps normal files and skips excluded directories", () => {
    run();
    for (const file of KEEP) expect(existsSync(join(root, file))).toBe(true);
  });
});
