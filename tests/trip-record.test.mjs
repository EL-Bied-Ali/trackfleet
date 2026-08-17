import assert from "node:assert/strict";
import test from "node:test";
import { tripStopsFromPlan } from "../app/lib/trip-record.ts";

test("trip snapshot freezes an ordered route independently from delivery state", () => {
  const stops = tripStopsFromPlan([
    { siteId: "tanger", destination: "Tanger", plannedArrivalAt: new Date("2026-08-20T10:00:00Z") },
    { siteId: "casa", destination: "Casablanca", plannedArrivalAt: new Date("2026-08-20T15:00:00Z") },
  ]);
  assert.deepEqual(stops.map((stop) => [stop.sequence, stop.siteId]), [[1, "tanger"], [2, "casa"]]);
});
