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
  assert.match(source, /setState\("visible"\)/);
  assert.match(source, /window\.addEventListener\("popstate", syncLocation\)/);
  assert.match(source, /\[locationKey\]/);
});

test("quick tools expose operations, history, storage, export and bulk import only after becoming visible", async () => {
  const source = await readFile(quickToolsUrl, "utf8");
  assert.match(source, /if \(state !== "visible"\) return null/);
  assert.match(source, /\/operations\?lang=/);
  assert.match(source, /\/operations\/history\?lang=/);
  assert.match(source, /\/operations\/storage\?lang=/);
  assert.match(source, /\/api\/operations\/export/);
  assert.match(source, /\/import\?lang=/);
});

test("root layout mounts quick tools once for the application", async () => {
  const source = await readFile(layoutUrl, "utf8");
  assert.match(source, /import QuickTools from "\.\/QuickTools"/);
  assert.match(source, /<QuickTools \/>/);
});

test("storage and export tools are hidden from non-dispatcher (agency) sessions", async () => {
  const source = await readFile(quickToolsUrl, "utf8");
  assert.match(source, /setIsDispatcher\(data\?\.company\?\.role === "dispatcher"\)/);
  assert.match(source, /\{isDispatcher && <a href=\{`\/operations\/storage/);
  assert.match(source, /\{isDispatcher && <a href="\/api\/operations\/export"/);
  // Operations, history and import stay visible to every authenticated role.
  assert.match(source, /<nav[^]*?<a href=\{`\/operations\?lang=/);
  assert.doesNotMatch(source, /isDispatcher && <a href=\{`\/operations\?lang=/);
  assert.doesNotMatch(source, /isDispatcher && <a href=\{`\/operations\/history/);
  assert.doesNotMatch(source, /isDispatcher && <a href=\{`\/import/);
});
