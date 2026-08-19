import test from "node:test";
import assert from "node:assert/strict";
import { shouldCreateDelayEvent } from "../app/lib/automation-delay.ts";

function delivery(overrides = {}) {
  const lastPositionAt = new Date("2026-08-16T18:00:00.000Z");
  return {
    id: "TF-AUTO-DELAY",
    customer: "Test customer",
    destination: "Casablanca, MA",
    destinationLatitude: null,
    destinationLongitude: null,
    arrivalRadiusKm: 0.5,
    truck: "TRK-001",
    driver: "Driver",
    status: "In transit",
    eta: "20:00",
    plannedArrivalAt: new Date("2026-08-16T20:00:00.000Z"),
    progress: 50,
    color: "#000000",
    contact: "",
    sendatrackVehicleId: "TRK-001",
    latitude: 40.4168,
    longitude: -3.7038,
    speed: 70,
    lastPositionAt,
    gpsSource: "sendatrack",
    companyId: "company",
    trackingToken: "token",
    createdAt: new Date("2026-08-16T06:00:00.000Z"),
    ...overrides,
  };
}

function event(type, createdAt, progress = 0) {
  return { deliveryId: "TF-AUTO-DELAY", type, progress, createdAt };
}

test("autonomous tick detects a material ETA delay after enough observed travel", () => {
  const events = [event("DEPARTED", new Date("2026-08-16T08:00:00.000Z"))];
  assert.equal(shouldCreateDelayEvent(delivery(), events), true);
});

test("autonomous tick does not flag delay before ETA confidence is sufficient", () => {
  const events = [event("DEPARTED", new Date("2026-08-16T17:30:00.000Z"))];
  assert.equal(shouldCreateDelayEvent(delivery(), events), false);
});

test("autonomous tick never duplicates an existing delay event", () => {
  const events = [
    event("DEPARTED", new Date("2026-08-16T08:00:00.000Z")),
    event("DELAY_DETECTED", new Date("2026-08-16T17:00:00.000Z"), 48),
  ];
  assert.equal(shouldCreateDelayEvent(delivery(), events), false);
});

test("unloading dwell suppresses new delay alerts after arrival at the site", () => {
  const events = [
    event("DEPARTED", new Date("2026-08-16T08:00:00.000Z")),
    event("ARRIVED_AT_SITE", new Date("2026-08-16T17:50:00.000Z"), 99),
  ];
  assert.equal(shouldCreateDelayEvent(delivery({ progress: 99 }), events), false);
});
