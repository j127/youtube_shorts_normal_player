import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION_FILES = [
  "package.json",
  "manifests/firefox.json",
  "manifests/chrome.json",
];

const VERSION_RE = /("version"\s*:\s*")([^"]*)(")/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function readVersion(text) {
  return JSON.parse(text).version;
}

// Regex replace (not JSON.stringify) so the file's formatting is preserved.
export function replaceVersion(text, version) {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid version "${version}", expected x.y.z`);
  }
  if (!VERSION_RE.test(text)) throw new Error("No version field found");
  return text.replace(VERSION_RE, `$1${version}$3`);
}

export function checkVersions(root = ".") {
  const versions = VERSION_FILES.map((file) => ({
    file,
    version: readVersion(readFileSync(join(root, file), "utf8")),
  }));
  const ok = new Set(versions.map((v) => v.version)).size === 1;
  return { ok, versions };
}

export function bumpVersion(version, root = ".") {
  const updated = VERSION_FILES.map((file) => {
    const path = join(root, file);
    return [path, replaceVersion(readFileSync(path, "utf8"), version)];
  });
  for (const [path, text] of updated) writeFileSync(path, text);
}

if (import.meta.main) {
  const [command, arg] = process.argv.slice(2);
  if (command === "check") {
    const { ok, versions } = checkVersions();
    for (const { file, version } of versions)
      console.log(`${version}\t${file}`);
    if (!ok) {
      console.error("Version mismatch");
      process.exit(1);
    }
  } else if (command === "bump" && arg) {
    try {
      bumpVersion(arg);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    console.log(`Set version to ${arg} in ${VERSION_FILES.join(", ")}`);
  } else {
    console.error("Usage: bun scripts/version.js check | bump <x.y.z>");
    process.exit(1);
  }
}
