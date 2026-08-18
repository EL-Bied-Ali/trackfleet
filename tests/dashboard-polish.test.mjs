import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [mapSource, polish, layout, i18n, page] = await Promise.all([
  readFile(new URL("../app/InteractiveFleetMap.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);

test("live map markers use one compact vehicle label instead of a GPS badge stack", () => {
  assert.match(mapSource, /compactVehicleLabel/);
  assert.match(mapSource, /<span aria-hidden="true">▰<\/span><em>/);
  assert.doesNotMatch(mapSource, /<b>GPS<\/b>/);
});

test("MapLibre is loaded only when the interactive map mounts", () => {
  assert.match(mapSource, /await import\("maplibre-gl"\)/);
  assert.doesNotMatch(mapSource, /import \* as maplibregl from "maplibre-gl"/);
  assert.match(mapSource, /maplibreRef/);
});

test("empty dashboard controls do not render as blank UI", () => {
  assert.match(polish, /\.map-panel \.panel-actions select:empty/);
  assert.match(page, /className="deliveries-empty"/);
  assert.match(page, /setModalOpen\(true\)/);
  assert.match(page, /setFilter\("All deliveries"\)/);
});

test("dashboard copy contains no stale demo person or fixed fleet totals", () => {
  assert.doesNotMatch(i18n, /Camille/);
  assert.doesNotMatch(i18n, /12 vehicles|12 véhicules|12 voertuigen/);
  assert.doesNotMatch(i18n, /20 vehicles reporting|20 véhicules connectés|20 voertuigen online/);
});

test("customer tracking links require private tracking tokens", () => {
  assert.match(page, /if \(!delivery\?\.trackingToken\)/);
  assert.match(page, /if \(!selected\.trackingToken\)/);
  assert.match(page, /searchParams\.set\("tracking", delivery\.trackingToken\)/);
  assert.match(page, /searchParams\.set\("tracking", selected\.trackingToken\)/);
  assert.doesNotMatch(page, /trackingToken \|\| deliveryId/);
  assert.doesNotMatch(page, /trackingToken \|\| selected\.id/);
});

test("fleet KPI counts vehicles rather than GPS devices", () => {
  assert.match(page, /integration\.vehicleCount/);
  assert.match(page, /"véhicules"/);
  assert.doesNotMatch(page, /\$\{integration\.vehicleCount\} GPS/);
});

test("dashboard polish stylesheet is loaded after global styles", () => {
  const globalIndex = layout.indexOf('import "./globals.css"');
  const polishIndex = layout.indexOf('import "./dashboard-polish.css"');
  assert.ok(globalIndex >= 0);
  assert.ok(polishIndex > globalIndex);
});
