import assert from "node:assert/strict";
import test from "node:test";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "../app/lib/trip-record.ts";

test("trip snapshot freezes an ordered route independently from delivery state", () => {
  const stops = tripStopsFromPlan([
    { siteId: "tanger", destination: "Tanger", plannedArrivalAt: new Date("2026-08-20T10:00:00Z") },
    { siteId: "casa", destination: "Casablanca", plannedArrivalAt: new Date("2026-08-20T15:00:00Z") },
  ]);
  assert.deepEqual(stops.map((stop) => [stop.sequence, stop.siteId]), [[1, "tanger"], [2, "casa"]]);
});


test("trip lifecycle follows assigned delivery statuses", () => {
  assert.equal(tripStatusFromDeliveryStatuses(["Loading", "Delivered"]), "planned");
  assert.equal(tripStatusFromDeliveryStatuses(["In transit", "Delivered"]), "active");
  assert.equal(tripStatusFromDeliveryStatuses(["Delayed"]), "active");
  assert.equal(tripStatusFromDeliveryStatuses(["Delivered", "Delivered"]), "completed");
});

test("a trip with zero currently-assigned deliveries is treated as completed, not planned -- it's orphaned, not new", () => {
  // A trip is only ever created (upsertTrip) from a plan that already has at
  // least one delivery, so an empty array here can only mean every delivery
  // that used to be on this trip has since been reassigned elsewhere (e.g.
  // moved to a different truck from the delivery table). Both
  // fleet-business-tick.ts and api/deliveries/route.ts sweep persisted trips
  // for exactly this case and close out anything that isn't already
  // "completed" -- returning "planned" here (the old behavior) silently
  // exempted every orphaned trip from that sweep forever, leaving dead trip
  // records that never close out.
  assert.equal(tripStatusFromDeliveryStatuses([]), "completed");
});
