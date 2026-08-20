import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const siteManager = fs.readFileSync("app/SiteManager.tsx", "utf8");
const operations = fs.readFileSync("app/operations/page.tsx", "utf8");
const quickTools = fs.readFileSync("app/QuickTools.tsx", "utf8");

test("customer tracking never exposes an internal unassigned vehicle label or invented position", () => {
  assert.match(page, /const customerVehicleLabel = isUnassignedVehicle\(selected\)/);
  assert.match(page, /Véhicule pas encore affecté/);
  assert.match(page, /label=\{`\$\{routeDirection\} · \$\{customerVehicleLabel\}`\}/);
  assert.match(map, /delivery\.id === selectedId && hasExactPosition\(delivery\)/);
});

test("quick tools react to in-app navigation and are localized", () => {
  assert.match(quickTools, /window\.addEventListener\("popstate", syncLocation\)/);
  assert.match(quickTools, /Opérations/);
  assert.match(quickTools, /Historique/);
  assert.match(quickTools, /Stockage/);
});

test("arrival completion hides unsafe actions until a real arrival is confirmed", () => {
  assert.match(siteManager, /arrivalConfirmed && <button[^>]+danger-button/);
  assert.match(siteManager, /!unassigned && !arrivalConfirmed/);
  assert.match(siteManager, /Camion à affecter/);
});

test("operational alerts provide a direct parcel action", () => {
  assert.match(operations, /viewDelivery: "Ouvrir le colis"/);
  assert.match(operations, /delivery=\$\{encodeURIComponent\(alert\.deliveryId\)\}/);
  assert.match(page, /get\("delivery"\)/);
});
