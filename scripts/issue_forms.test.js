import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../.github/ISSUE_TEMPLATE");
// config.yml configures the chooser and isn't a form.
const FORMS = readdirSync(DIR).filter(
  (name) => /\.ya?ml$/.test(name) && !/^config\.ya?ml$/.test(name)
);

const read = (name) => readFileSync(join(DIR, name), "utf8");

test("there are issue forms to check", () => {
  expect(FORMS).toContain("bug-report.yaml");
  expect(FORMS).toContain("shorts-player-notice.yaml");
});

describe.each(FORMS)("%s", (name) => {
  const text = read(name);
  const form = Bun.YAML.parse(text);

  test("has the keys GitHub needs", () => {
    expect(typeof form.name).toBe("string");
    expect(typeof form.description).toBe("string");
    expect(Array.isArray(form.body)).toBe(true);
  });

  test("gives every field a unique id", () => {
    const fields = form.body.filter((item) => item.type !== "markdown");
    const ids = fields.map((item) => item.id);
    for (const id of ids) expect(typeof id).toBe("string");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("gives every dropdown options", () => {
    for (const item of form.body.filter((i) => i.type === "dropdown")) {
      expect(item.attributes.options.length).toBeGreaterThan(0);
    }
  });

  // After the Shorts player fallback, the extension keeps that tab, and that
  // Short in every tab, in the Shorts player until the browser restarts, so
  // retrying it signed out would wrongly look like the account isn't the cause.
  test("says how to test signed out without hitting the fallback", () => {
    if (!form.body.some((item) => item.id === "signed-out")) return;
    expect(text).toContain("new tab");
    expect(text).toContain("different Short");
    // Extensions are off in private windows by default.
    expect(text).toContain("extensions are off in private windows by default");
  });
});
