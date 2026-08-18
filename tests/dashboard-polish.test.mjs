import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [mapSource, polish, layout, i18n] = await Promise.all([
  readFile(new URL("../app/InteractiveFleetMap.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
]);

test("live map markers use one compact vehicle label instead of a GPS badge stack", () => {
  assert.match(mapSource, /compactVehicleLabel/);
  assert.match(mapSource, /<span aria-hidden="true">▰<\/span><em>/);
  assert.doesNotMatch(mapSource, /<b>GPS<\/b>/);
});

test("empty dashboard controls do not render as blank UI", () => {
  assert.match(polish, /\.map-panel \.panel-actions select:empty/);
  assert.match(polish, /\.table-wrap:has\(tbody:empty\)::after/);
});

test("dashboard copy contains no stale demo person or fixed fleet totals", () => {
  assert.doesNotMatch(i18n, /Camille/);
  assert.doesNotMatch(i18n, /12 vehicles|12 véhicules|12 voertuigen/);
  assert.doesNotMatch(i18n, /20 vehicles reporting|20 véhicules connectés|20 voertuigen online/);
});

test("active delivery KPI does not add a redundant GPS badge", () => {
  assert.match(polish, /\.stats-grid \.stat-card:first-child em\.up/);
  assert.match(polish, /display:\s*none/);
});

test("dashboard polish stylesheet is loaded after global styles", () => {
  const globalIndex = layout.indexOf('import "./globals.css"');
  const polishIndex = layout.indexOf('import "./dashboard-polish.css"');
  assert.ok(globalIndex >= 0);
  assert.ok(polishIndex > globalIndex);
});
