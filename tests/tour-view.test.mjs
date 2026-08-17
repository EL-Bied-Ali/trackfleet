import assert from "node:assert/strict";
import test from "node:test";
import { activeTourDisplayId, activeTourKey, stopSequence, tourCustomerCount, tourDeliveryCount } from "../app/lib/tour-view.ts";

const plan = {
  vehicleKey: "veh-TRK-014",
  truck: "TRK-014",
  sendatrackVehicleId: "veh-TRK-014",
  tripInstanceId: "TRIP-ABC123",
  stops: [
    { siteId: "casa", destination: "Casablanca", plannedArrivalAt: "2026-08-17T12:00:00Z", deliveryIds: ["TF-1", "TF-2"], customers: ["A", "B"] },
    { siteId: "marrakech", destination: "Marrakech", plannedArrivalAt: "2026-08-17T17:00:00Z", deliveryIds: ["TF-3"], customers: ["B"] },
  ],
};

test("uses the real trip instance id when the server provides it", () => {
  assert.equal(activeTourDisplayId(plan), "TRIP-ABC123");
});

test("falls back to a compact vehicle id before a trip instance exists", () => {
  assert.equal(activeTourDisplayId({ ...plan, tripInstanceId: null }), "TOUR-EHTRK014");
});

test("counts deliveries and unique customers across a tour", () => {
  assert.equal(tourDeliveryCount(plan), 3);
  assert.equal(tourCustomerCount(plan), 2);
});

test("numbers stops in server-provided order", () => {
  assert.deepEqual(stopSequence(plan).map((stop) => [stop.sequence, stop.siteId]), [[1, "casa"], [2, "marrakech"]]);
});


test("explicit trip ids keep two trips of the same truck visually distinct", () => {
  const base = { vehicleKey: "gps-1", truck: "TRK-1", sendatrackVehicleId: "gps-1", stops: [] };
  const a = { ...base, tripId: "TRIP-A", tripInstanceId: "LEGACY-A" };
  const b = { ...base, tripId: "TRIP-B", tripInstanceId: "LEGACY-B" };
  assert.equal(activeTourDisplayId(a), "TRIP-A");
  assert.equal(activeTourDisplayId(b), "TRIP-B");
  assert.notEqual(activeTourKey(a), activeTourKey(b));
});
