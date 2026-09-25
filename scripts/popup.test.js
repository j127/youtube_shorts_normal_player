import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const read = (path) => readFileSync(join(import.meta.dir, "..", path), "utf8");

const SOURCE = read("src/popup.js");
const HTML = read("src/popup.html");
const MANIFESTS = ["firefox", "chrome"].map((name) =>
  JSON.parse(read(`manifests/${name}.json`))
);

// Let pending promise callbacks run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function element() {
  const listeners = {};
  return {
    className: "",
    textContent: "",
    hidden: false,
    listeners,
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
}

// Run popup.js against fake popup elements and a fake permissions API, the way
// the browser runs it when the toolbar button is clicked.
async function openPopup({
  contains,
  request = async () => true,
  namespace = "browser",
}) {
  const elements = { status: element(), grant: element(), version: element() };
  elements.grant.hidden = true; // As in popup.html.
  const calls = { contains: [], request: [] };
  const api = {
    permissions: {
      contains: (permissions) => {
        calls.contains.push(permissions);
        return contains();
      },
      request: (permissions) => {
        calls.request.push(permissions);
        return request();
      },
    },
    runtime: { getManifest: () => ({ version: "9.9.9" }) },
  };

  const context = {
    document: { getElementById: (id) => elements[id] },
    [namespace]: api,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  await settle();

  return { ...elements, calls, click: () => elements.grant.listeners.click() };
}

describe("popup.js", () => {
  test("shows that it's active when YouTube access is granted", async () => {
    const popup = await openPopup({ contains: async () => true });
    expect(popup.status.className).toBe("ok");
    expect(popup.status.textContent).toContain("Active on YouTube");
    expect(popup.grant.hidden).toBe(true);
  });

  test("offers to grant access when it's missing", async () => {
    const popup = await openPopup({ contains: async () => false });
    expect(popup.status.className).toBe("warn");
    expect(popup.status.textContent).toContain("No access to YouTube");
    expect(popup.grant.hidden).toBe(false);
  });

  test("reports a failed check", async () => {
    const popup = await openPopup({
      contains: () => Promise.reject(new Error("nope")),
    });
    expect(popup.status.className).toBe("warn");
    expect(popup.status.textContent).toContain("Couldn't check");
    expect(popup.grant.hidden).toBe(true);
  });

  test("asks for exactly the manifests' host permissions", async () => {
    const popup = await openPopup({ contains: async () => false });
    popup.click();
    for (const manifest of MANIFESTS) {
      expect(popup.calls.contains[0].origins).toEqual(
        manifest.host_permissions
      );
      expect(popup.calls.request[0].origins).toEqual(manifest.host_permissions);
    }
  });

  test("requests access synchronously in the click handler", async () => {
    // Firefox rejects permissions.request() once the user-input handler returns.
    const popup = await openPopup({ contains: async () => false });
    popup.click();
    expect(popup.calls.request).toHaveLength(1);
  });

  test("shows access after the user grants it", async () => {
    const popup = await openPopup({
      contains: async () => false,
      request: async () => true,
    });
    popup.click();
    await settle();
    expect(popup.status.className).toBe("ok");
    expect(popup.grant.hidden).toBe(true);
  });

  test("keeps offering access if the user declines", async () => {
    const popup = await openPopup({
      contains: async () => false,
      request: async () => false,
    });
    popup.click();
    await settle();
    expect(popup.status.className).toBe("warn");
    expect(popup.grant.hidden).toBe(false);
  });

  test("checks again if the request fails", async () => {
    const popup = await openPopup({
      contains: async () => false,
      request: () => Promise.reject(new Error("closed")),
    });
    popup.click();
    await settle();
    expect(popup.calls.contains).toHaveLength(2);
    expect(popup.grant.hidden).toBe(false);
  });

  test("works with Chrome's namespace", async () => {
    const popup = await openPopup({
      contains: async () => true,
      namespace: "chrome",
    });
    expect(popup.status.className).toBe("ok");
  });

  test("shows the extension version", async () => {
    const popup = await openPopup({ contains: async () => true });
    expect(popup.version.textContent).toBe("Version 9.9.9");
  });
});

describe("popup.html", () => {
  test("has the elements popup.js uses", () => {
    for (const id of ["status", "grant", "version"]) {
      expect(HTML).toContain(`id="${id}"`);
    }
    expect(HTML).toMatch(/<button id="grant"[^>]*\bhidden\b/);
  });

  test("loads popup.js with no inline scripts (MV3 CSP forbids them)", () => {
    const scripts = [...HTML.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/g)];
    expect(scripts.map(([, attrs]) => attrs.trim())).toEqual([
      'src="popup.js"',
    ]);
    expect(scripts.every(([, , body]) => body.trim() === "")).toBe(true);
  });
});
