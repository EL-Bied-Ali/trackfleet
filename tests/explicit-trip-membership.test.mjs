import assert from "node:assert/strict";
import test from "node:test";
import { buildTruckStopPlans } from "../app/lib/truck-stop-plan.ts";

function delivery(id, tripId, destinationSiteId) {
  return { id, customer: id, originSiteId: "brussels", originLatitude: null, originLongitude: null, destinationSiteId, destination: destinationSiteId, destinationLatitude: null, destinationLongitude: null, arrivalRadiusKm: 0.5, truck: "TRK-1", driver: "", status: "Loading", eta: "", plannedArrivalAt: new Date("2026-08-20T12:00:00Z"), progress: 0, color: "#000", contact: "", sendatrackVehicleId: "gps-1", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "c1", trackingToken: id, tripId, createdAt: new Date() };
}

test("same truck can have separate explicit trips without mixing parcels", () => {
  const plans = buildTruckStopPlans([delivery("A", "TRIP-A", "casablanca"), delivery("B", "TRIP-B", "agadir")]);
  assert.equal(plans.length, 2);
  assert.deepEqual(new Set(plans.map((plan) => plan.tripId)), new Set(["TRIP-A", "TRIP-B"]));
});

test("legacy deliveries without trip id still group by vehicle", () => {
  const plans = buildTruckStopPlans([delivery("A", null, "casablanca"), delivery("B", null, "agadir")]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].tripId, null);
});
