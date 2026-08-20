import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const siteManager = fs.readFileSync("app/SiteManager.tsx", "utf8");
const operations = fs.readFileSync("app/operations/page.tsx", "utf8");
const i18n = fs.readFileSync("app/i18n.ts", "utf8");

test("customer tracking never exposes an internal unassigned vehicle label or invented position", () => {
  assert.match(page, /const customerVehicleLabel = isUnassignedVehicle\(selected\)/);
  assert.match(page, /Véhicule pas encore affecté/);
  assert.match(page, /label=\{`\$\{routeDirection\} · \$\{customerVehicleLabel\}`\}/);
  assert.match(map, /delivery\.id === selectedId && hasExactPosition\(delivery\)/);
});

test("quick tools live in the dispatcher sidebar and are localized", () => {
  assert.match(i18n, /operationsTool: "Opérations"/);
  assert.match(page, /a className="nav-item" href=\{`\/operations\?lang=\$\{locale\}`\}/);
  assert.match(page, /a className="nav-item" href=\{`\/operations\/history\?lang=\$\{locale\}`\}/);
  assert.match(page, /company\?\.role === "dispatcher" && <a className="nav-item" href=\{`\/operations\/storage\?lang=\$\{locale\}`\}/);
  assert.match(page, /company\?\.role === "dispatcher" && <a className="nav-item" href="\/api\/operations\/export"/);
});

test("arrival completion hides unsafe actions until a real arrival is confirmed", () => {
  assert.match(siteManager, /arrivalConfirmed && <button[^>]+danger-button/);
  assert.match(siteManager, /!unassigned && !arrivalConfirmed/);
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

test("agency management is searchable and keeps the edit form closed by default", () => {
  assert.match(siteManager, /siteSearch/);
  assert.match(siteManager, /siteFormOpen/);
  assert.match(siteManager, /gpsReady/);
  assert.match(siteManager, /gpsMissing/);
});
