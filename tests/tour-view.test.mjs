import assert from "node:assert/strict";
import test from "node:test";
import { activeTourDisplayId, stopSequence, tourCustomerCount, tourDeliveryCount } from "../app/lib/tour-view.ts";

const plan = {
  vehicleKey: "veh-TRK-014",
  truck: "TRK-014",
  sendatrackVehicleId: "veh-TRK-014",
  stops: [
    { siteId: "casa", destination: "Casablanca", plannedArrivalAt: "2026-08-17T12:00:00Z", deliveryIds: ["TF-1", "TF-2"], customers: ["A", "B"] },
    { siteId: "marrakech", destination: "Marrakech", plannedArrivalAt: "2026-08-17T17:00:00Z", deliveryIds: ["TF-3"], customers: ["B"] },
  ],
};

test("builds a compact stable display id from the active vehicle key", () => {
  assert.equal(activeTourDisplayId(plan), "TOUR-HTRK014");
});

test("counts deliveries and unique customers across a tour", () => {
  assert.equal(tourDeliveryCount(plan), 3);
  assert.equal(tourCustomerCount(plan), 2);
});

test("numbers stops in server-provided order", () => {
  assert.deepEqual(stopSequence(plan).map((stop) => [stop.sequence, stop.siteId]), [[1, "casa"], [2, "marrakech"]]);
});
