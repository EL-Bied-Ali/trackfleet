import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const i18nUrl = new URL("../app/i18n.ts", import.meta.url);

test("customer tracking page keeps only customer-facing content, not internal operations tools", async () => {
  // Scoped to renderCustomerView specifically -- the dispatcher's own
  // sidebar legitimately links to Revenue/History now (see the 2026-09-01
  // sidebar-reordering request), so a blanket "nowhere in page.tsx" check
  // would be wrong. The customer-facing tracking page never had a nav at
  // all (see the "old standalone QuickTools component is gone" test below)
  // and must stay that way.
  const page = await readFile(pageUrl, "utf8");
  const customerViewStart = page.indexOf("function renderCustomerView");
  const customerViewEnd = page.indexOf("if (view === \"customer\") return renderCustomerView();");
  assert.ok(customerViewStart > -1 && customerViewEnd > customerViewStart, "expected to find renderCustomerView's source range");
  const customerView = page.slice(customerViewStart, customerViewEnd);
  assert.doesNotMatch(customerView, /href=\{`\/operations(?:\/history|\/revenue|\/storage)?\?lang=\$\{locale\}`\}/);
  assert.doesNotMatch(customerView, /href="\/api\/operations\/export"/);
});

test("the dispatcher sidebar links to Revenue and History, available to both dispatcher and agency (each API scopes agency to its own site)", async () => {
  // Unlike Export (dispatcher-only, see getDispatcherSession below), Revenue
  // and History both authenticate via getCompanySession and scope agency
  // sessions to their own siteId server-side (app/api/operations/revenue and
  // history routes) -- so the sidebar link must not be dispatcher-gated
  // either, or it would hide a feature agencies can actually use.
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /<a className="nav-item" href=\{`\/operations\/revenue\?lang=\$\{locale\}`\}>/);
  assert.match(page, /<a className="nav-item" href=\{`\/operations\/history\?lang=\$\{locale\}`\}>/);
  assert.doesNotMatch(page, /company\?\.role === "dispatcher" && <a className="nav-item" href=\{`\/operations\/revenue/);
  assert.doesNotMatch(page, /company\?\.role === "dispatcher" && <a className="nav-item" href=\{`\/operations\/history/);
});

test("the dispatcher sidebar order matches the requested layout: overview, then scan/revenue/history/guide, then theme/settings/help, then export/import last", async () => {
  const page = await readFile(pageUrl, "utf8");
  const sidebarStart = page.indexOf('<aside className="sidebar">');
  const sidebarEnd = page.indexOf('<div className="sidebar-spacer" />');
  assert.ok(sidebarStart > -1 && sidebarEnd > sidebarStart, "expected to find the dispatcher sidebar's source range");
  const sidebar = page.slice(sidebarStart, sidebarEnd);
  const order = ["/scan/connect", "/operations/revenue", "/operations/history", "/guide", "theme-toggle", "openCompanySettings", "/api/operations/export", "/import?lang"]
    .map((marker) => sidebar.indexOf(marker));
  assert.ok(order.every((index) => index > -1), "expected every nav marker to be present in the sidebar");
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] > order[i - 1], `expected nav marker at index ${i} to appear after the previous one (got positions ${order})`);
  }
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
