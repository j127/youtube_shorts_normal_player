import util from "util";
import { exec } from "child_process";
import fs from "fs";

const execAsync = util.promisify(exec);

type BrowserName = "firefox" | "chrome";
type BumpLevel = "major" | "minor" | "patch";
type Manifest = { version: string };

function loadManifest(target: BrowserName) {
    const manifest = require(`../manifests/${target}.json`);
    return manifest;
}

async function npmVersion(bumpLevel: BumpLevel): Promise<string> {
    const newVersion = await execAsync(`npm version ${bumpLevel}`);
    if (newVersion.stderr) {
        throw new Error(newVersion.stderr);
    }
    return newVersion.stdout.trim();
}

function getBumpLevelOrExit(): BumpLevel {
    if (process.argv.length < 3) {
        throw new Error(
            "No bump level provided. Usage: yarn version_update -- [major|minor|patch]"
        );
    }

    const bumpLevel = process.argv[2] as BumpLevel;
    return bumpLevel;
}

function updateManifest(
    manifestContent: Manifest,
    newVersion: string
): Manifest {
    return { ...manifestContent, version: newVersion };
}

function saveManifest(target: BrowserName, manifest: Manifest): void {
    const manifestPath = `manifests/${target}.json`;
    fs.writeFile(manifestPath, JSON.stringify(manifest), (err) => {
        if (err) {
            throw new Error(err.message);
        }
    });
}

async function updateManifests(
    target: BrowserName,
    newVersion: string
): Promise<void> {
    const firefoxManifest = loadManifest("firefox");
    const chromeManifest = loadManifest("chrome");

    const updatedFirefoxManifest = updateManifest(firefoxManifest, newVersion);
    const updatedChromeManifest = updateManifest(chromeManifest, newVersion);

    await Promise.all([
        saveManifest("firefox", updatedFirefoxManifest),
        saveManifest("chrome", updatedChromeManifest),
    ]);
}

function main(): void {
    console.log("working");
    const bumpLevel = getBumpLevelOrExit();
    updateManifests("firefox", bumpLevel);
    updateManifests("chrome", bumpLevel);
}

main();
