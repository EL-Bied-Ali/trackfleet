import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const quickToolsUrl = new URL("../app/QuickTools.tsx", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);

test("quick tools are hidden outside the authenticated dashboard and on public tracking links", async () => {
  const source = await readFile(quickToolsUrl, "utf8");
  assert.match(source, /url\.pathname !== "\/"/);
  assert.match(source, /url\.searchParams\.has\("tracking"\)/);
  assert.match(source, /fetch\("\/api\/auth\/session"/);
  assert.match(source, /response\.ok \? "visible" : "hidden"/);
});

test("quick tools expose operations and bulk import only after becoming visible", async () => {
  const source = await readFile(quickToolsUrl, "utf8");
  assert.match(source, /if \(state !== "visible"\) return null/);
  assert.match(source, /\/operations\?lang=/);
  assert.match(source, /\/import\?lang=/);
});

test("root layout mounts quick tools once for the application", async () => {
  const source = await readFile(layoutUrl, "utf8");
  assert.match(source, /import QuickTools from "\.\/QuickTools"/);
  assert.match(source, /<QuickTools \/>/);
});
