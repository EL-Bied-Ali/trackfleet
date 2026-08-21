import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queryUrl = new URL("../app/lib/delivery-revenue.postgres.ts", import.meta.url);
const routeUrl = new URL("../app/api/operations/revenue/route.ts", import.meta.url);
const pageUrl = new URL("../app/operations/revenue/page.tsx", import.meta.url);
const navUrl = new URL("../app/page.tsx", import.meta.url);
const i18nUrl = new URL("../app/i18n.ts", import.meta.url);

test("revenue report scopes by company, only sums priced parcels, and never uses OFFSET", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /WHERE company_id = \$\{companyId\}/);
  assert.match(source, /price_amount IS NOT NULL/);
  assert.match(source, /price_currency IS NOT NULL/);
  assert.doesNotMatch(source, /\bOFFSET\b/i);
});

test("revenue report never sums EUR and MAD together and covers today, 7d, 30d and all-time", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /GROUP BY price_currency/);
  assert.match(source, /'today'/);
  assert.match(source, /'last7d'/);
  assert.match(source, /'last30d'/);
  assert.match(source, /'allTime'/);
});

test("agency-scoped requests are filtered to their own origin site and skip the cross-agency breakdown", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /origin_site_id = \$\{siteId\}/);
  assert.match(source, /if \(!siteId\)/);
});

test("unpriced parcels (no declared weight) are surfaced separately, not silently dropped", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /price_amount IS NULL OR price_currency IS NULL/);
  assert.match(source, /unpricedCount/);
});

test("revenue API requires a company session and scopes agency callers to their own site", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /getCompanySession\(request\)/);
  assert.match(source, /session\.role === "agency" \? session\.siteId : null/);
  assert.match(source, /status: 401/);
});

test("revenue is reachable from the dashboard sidebar and localized", async () => {
  const nav = await readFile(navUrl, "utf8");
  const i18n = await readFile(i18nUrl, "utf8");
  assert.match(nav, /href=\{`\/operations\/revenue\?lang=\$\{locale\}`\}/);
  assert.match(i18n, /revenueTool: "Revenue"/);
  assert.match(i18n, /revenueTool: "Revenus"/);
  assert.match(i18n, /revenueTool: "Omzet"/);
});

test("revenue dashboard fetches its own report endpoint and redirects unauthenticated visitors", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /fetch\("\/api\/operations\/revenue"/);
  assert.match(page, /response\.status === 401/);
  assert.match(page, /window\.location\.assign/);
});
