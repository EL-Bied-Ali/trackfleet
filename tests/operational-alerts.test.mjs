import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function transpile(url) {
  const source = await readFile(url, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function loadAlertsModule() {
  const vehicleCode = await transpile(new URL("../app/lib/delivery-vehicle-choice.ts", import.meta.url));
  const vehicleExports = {};
  new Function("exports", vehicleCode)(vehicleExports);

  const knownSitesCode = await transpile(new URL("../app/lib/known-sites.ts", import.meta.url));
  const knownSitesExports = {};
  new Function("exports", knownSitesCode)(knownSitesExports);

  const alertCode = await transpile(new URL("../app/lib/operational-alerts.ts", import.meta.url));
  const alertExports = {};
  const require = (id) => {
    if (id === "./delivery-vehicle-choice") return vehicleExports;
    if (id === "./known-sites") return knownSitesExports;
    throw new Error(`Unexpected require: ${id}`);
  };
  new Function("exports", "require", alertCode)(alertExports, require);
  return { ...alertExports, ...vehicleExports, ...knownSitesExports };
}

function delivery(overrides = {}) {
  return {
    id: "D-1",
    customer: "Client",
    destination: "Casablanca",
    truck: "TRUCK-1",
    status: "In transit",
    sendatrackVehicleId: "vehicle-1",
    gpsFresh: true,
    positionAgeMinutes: 5,
    etaDelayMinutes: 0,
    plannedArrivalAt: "2026-08-19T18:00:00.000Z",
    destinationLatitude: 33.5731,
    destinationLongitude: -7.5898,
    ...overrides,
  };
}

test("healthy active delivery produces no anomaly", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const result = detectOperationalAlerts([delivery()], true, new Date("2026-08-19T15:00:00.000Z"));
  assert.equal(result.alerts.length, 0);
  assert.equal(result.affectedDeliveries, 0);
});

test("integration outage is a critical system alert", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const result = detectOperationalAlerts([], false, new Date("2026-08-19T15:00:00.000Z"));
  assert.equal(result.critical, 1);
  assert.equal(result.alerts[0].kind, "integration_offline");
  assert.equal(result.alerts[0].deliveryId, null);
});

test("stale GPS escalates to critical after two hours", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const result = detectOperationalAlerts([delivery({ positionAgeMinutes: 130, gpsFresh: false })], true);
  const alert = result.alerts.find((item) => item.kind === "gps_stale");
  assert.equal(alert?.severity, "critical");
  assert.equal(alert?.ageMinutes, 130);
});

test("unassigned vehicle, severe ETA and missing geocode are surfaced together", async () => {
  const { detectOperationalAlerts, UNASSIGNED_TRUCK } = await loadAlertsModule();
  const result = detectOperationalAlerts([
    delivery({
      truck: UNASSIGNED_TRUCK,
      sendatrackVehicleId: "",
      etaDelayMinutes: 95,
      destinationLatitude: null,
      destinationLongitude: null,
    }),
  ], true, new Date("2026-08-19T15:00:00.000Z"));
  assert.deepEqual(new Set(result.alerts.map((alert) => alert.kind)), new Set([
    "vehicle_unassigned",
    "eta_severely_delayed",
    "destination_not_geocoded",
  ]));
  assert.equal(result.affectedDeliveries, 1);
});

test("overdue planned arrival is ignored until 30 minutes and then escalates", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const recent = detectOperationalAlerts([
    delivery({ plannedArrivalAt: "2026-08-19T14:40:00.000Z" }),
  ], true, new Date("2026-08-19T15:00:00.000Z"));
  assert.equal(recent.alerts.some((alert) => alert.kind === "planned_arrival_overdue"), false);

  const late = detectOperationalAlerts([
    delivery({ plannedArrivalAt: "2026-08-19T11:00:00.000Z" }),
  ], true, new Date("2026-08-19T15:00:00.000Z"));
  const alert = late.alerts.find((item) => item.kind === "planned_arrival_overdue");
  assert.equal(alert?.severity, "critical");
  assert.equal(alert?.delayMinutes, 240);
});

test("stale GPS on a CTM-relay destination is not alerted -- that's the expected state for that leg", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const result = detectOperationalAlerts([
    delivery({ positionAgeMinutes: 500, gpsFresh: false, destinationSiteId: "tanger-ville-said-kotb-19a" }),
  ], true, new Date("2026-08-19T15:00:00.000Z"));
  assert.equal(result.alerts.some((alert) => alert.kind === "gps_stale"), false);
});

test("stale GPS on a non-relay destination still alerts even when destinationSiteId is set", async () => {
  const { detectOperationalAlerts } = await loadAlertsModule();
  const result = detectOperationalAlerts([
    delivery({ positionAgeMinutes: 130, gpsFresh: false, destinationSiteId: "casablanca-mohammed-vi-959" }),
  ], true, new Date("2026-08-19T15:00:00.000Z"));
  const alert = result.alerts.find((item) => item.kind === "gps_stale");
  assert.equal(alert?.severity, "critical");
});

test("completed deliveries do not create delivery-level operational alerts", async () => {
  const { detectOperationalAlerts, UNASSIGNED_TRUCK } = await loadAlertsModule();
  const result = detectOperationalAlerts([
    delivery({ status: "Delivered", truck: UNASSIGNED_TRUCK, sendatrackVehicleId: "", positionAgeMinutes: 999, etaDelayMinutes: 999, destinationLatitude: null }),
  ], true);
  assert.equal(result.alerts.length, 0);
});
