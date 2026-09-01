import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const siteManager = fs.readFileSync("app/SiteManager.tsx", "utf8");
const operations = fs.readFileSync("app/operations/page.tsx", "utf8");
const i18n = fs.readFileSync("app/i18n.ts", "utf8");
const globalsCss = fs.readFileSync("app/globals.css", "utf8");

test("the unassigned-parcel suggestion label and its detail text render on separate lines, not run together", () => {
  // Regression guard: .eta-explanation had no CSS at all, so its <strong>
  // title and following <span> detail rendered as adjacent inline elements
  // with no space between them -- e.g. "No safe suggestionThe parcel simply
  // remains waiting for assignment." with no gap. Found live on the
  // production dashboard.
  assert.match(globalsCss, /\.eta-explanation strong, \.eta-explanation span \{ display: block; \}/);
});

test("customer tracking never exposes an internal unassigned vehicle label or invented position", () => {
  assert.match(page, /const customerVehicleLabel = isUnassignedVehicle\(selected\)/);
  assert.match(page, /Véhicule pas encore affecté/);
  assert.match(page, /label=\{`\$\{routeDirection\} · \$\{customerVehicleLabel\}`\}/);
  assert.match(map, /delivery\.id === selectedId && hasExactPosition\(delivery\)/);
});

test("quick tools live in the dispatcher sidebar and are localized", () => {
  // The Opérations/Historique/Stockage sidebar links were removed as part
  // of a broader nav simplification (see "Update sidebar navigation
  // regression guard") -- those pages are still real and working, just no
  // longer linked directly from the sidebar. Export is still there.
  assert.match(i18n, /operationsTool: "Opérations"/);
  assert.match(page, /company\?\.role === "dispatcher" && <a className="nav-item" href="\/api\/operations\/export"/);
});

test("arrival completion hides unsafe actions until a real arrival is confirmed", () => {
  assert.match(siteManager, /arrivalConfirmed && <button[^>]+danger-button/);
  assert.match(siteManager, /!unassigned && !departurePending\(delivery\) && !arrivalConfirmed/);
  assert.match(siteManager, /Camion à affecter/);
});

test("operational alerts provide a direct parcel action", () => {
  assert.match(operations, /viewDelivery: "Ouvrir le colis"/);
  assert.match(operations, /delivery=\$\{encodeURIComponent\(alert\.deliveryId!\)\}/);
  assert.match(operations, /window\.location\.assign/);
  assert.match(page, /get\("delivery"\)/);
});

test("overlapping live trucks remain individually visible", () => {
  assert.match(map, /function overlapOffset/);
  assert.match(map, /markerOccurrences/);
  assert.match(page, /className="fleet-roster"/);
  assert.match(page, /integration\.vehicles\.map/);
});

test("overlap detection buckets by projected screen pixels, not raw GPS coordinates", () => {
  // Regression guard, reproduced live: the corridor map spans Belgium to
  // Morocco, zoomed out enough that vehicles several kilometers apart in
  // the same city land on the same or adjacent screen pixel. Bucketing by
  // raw lng/lat (rounded to 5 decimals, ~1m precision) only caught markers
  // with near-identical GPS fixes and silently stacked distinct trucks with
  // no visual indication -- three vehicles rendered at the exact same pixel
  // on the live dashboard, leaving only one visible/clickable of the three.
  assert.match(map, /function overlapOffset\(pixel: \{ x: number; y: number \}, occurrences: Map<string, number>\)/);
  assert.doesNotMatch(map, /position\[0\]\.toFixed\(5\)/);
  const projectedCallSites = map.match(/overlapOffset\(map\.project\(position\), markerOccurrences\)/g) ?? [];
  assert.equal(projectedCallSites.length, 2, "both the delivery-linked and gps-only marker loops must project before bucketing");
});

test("agency management is searchable and keeps the edit form closed by default", () => {
  assert.match(siteManager, /siteSearch/);
  assert.match(siteManager, /siteFormOpen/);
  assert.match(siteManager, /gpsReady/);
  assert.match(siteManager, /gpsMissing/);
});
