import assert from "node:assert/strict";
import test from "node:test";
import { buildEtaObservation } from "../app/lib/eta-observation.ts";

const row = {
  id: "TF-ETA-1",
  customer: "Client",
  originSiteId: "origin",
  originLatitude: 50.8503,
  originLongitude: 4.3517,
  destinationSiteId: "destination",
  destination: "Casablanca, Maroc",
  destinationLatitude: 33.5731,
  destinationLongitude: -7.5898,
  arrivalRadiusKm: 0.5,
  truck: "TRK-014",
  driver: "Driver",
  status: "In transit",
  eta: "12:00",
  plannedArrivalAt: new Date("2026-08-18T12:00:00Z"),
  progress: 45,
  color: "#000",
  contact: "",
  sendatrackVehicleId: "veh-14",
  latitude: 40.4168,
  longitude: -3.7038,
  speed: 70,
  lastPositionAt: new Date("2026-08-17T10:00:00Z"),
  gpsSource: "sendatrack",
  companyId: "company-a",
  trackingToken: "token",
  createdAt: new Date("2026-08-16T10:00:00Z"),
};

const events = [{ deliveryId: row.id, type: "DEPARTED", progress: 1, createdAt: new Date("2026-08-16T20:00:00Z") }];

test("builds a persistable ETA observation from a real SENDATRACK fix", () => {
  const observation = buildEtaObservation(row, events, [row]);
  assert.ok(observation);
  assert.equal(observation.deliveryId, row.id);
  assert.equal(observation.positionAt.getTime(), row.lastPositionAt.getTime());
  assert.ok(observation.estimatedArrivalAt instanceof Date);
  assert.ok(observation.remainingDistanceKm > 0);
  assert.equal(observation.progress, 45);
  assert.ok(["baseline-model", "observed-pace"].includes(observation.source));
});

test("does not collect synthetic or missing GPS positions", () => {
  assert.equal(buildEtaObservation({ ...row, gpsSource: "simulation" }, events, [row]), null);
  assert.equal(buildEtaObservation({ ...row, lastPositionAt: null }, events, [row]), null);
});
