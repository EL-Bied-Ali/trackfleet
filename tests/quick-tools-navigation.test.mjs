import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const i18nUrl = new URL("../app/i18n.ts", import.meta.url);

test("customer sidebar keeps only customer-facing quick tools, not internal operations", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /a className="nav-item" href=\{`\/import\?lang=\$\{locale\}`\}/);
  assert.doesNotMatch(page, /href=\{`\/operations(?:\/history|\/revenue|\/storage)?\?lang=\$\{locale\}`\}/);
});

test("export remains limited to dispatcher sessions", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /company\?\.role === "dispatcher" && <a className="nav-item" href="\/api\/operations\/export"/);
});

test("quick tools translations exist for every locale", async () => {
  const i18n = await readFile(i18nUrl, "utf8");
  assert.match(i18n, /operationsTool: "Operations".*historyTool: "History".*storageTool: "Storage".*exportTool: "Export".*importTool: "Import"/);
  assert.match(i18n, /operationsTool: "Opérations".*historyTool: "Historique".*storageTool: "Stockage".*exportTool: "Exporter".*importTool: "Importer"/);
  assert.match(i18n, /operationsTool: "Operaties".*historyTool: "Historiek".*storageTool: "Opslag".*exportTool: "Exporteren".*importTool: "Importeren"/);
});

test("the old standalone QuickTools component is gone and not mounted in the root layout", async () => {
  const layout = await readFile(layoutUrl, "utf8");
  assert.doesNotMatch(layout, /QuickTools/);
  await assert.rejects(readFile(new URL("../app/QuickTools.tsx", import.meta.url)));
  await assert.rejects(readFile(new URL("../app/quick-tools.module.css", import.meta.url)));
});
