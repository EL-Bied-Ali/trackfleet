import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCompletedTripRoutes } from "../app/lib/trip-history-summary.ts";

function trip(overrides = {}) {
  return {
    id: "TRIP-1",
    companyId: "company-a",
    routeTemplateId: "route-be-ma",
    vehicleKey: "truck-1",
    truck: "TR-17",
    sendatrackVehicleId: "v1",
    originSiteId: "brussels",
    stops: [
      { siteId: "tanger", destination: "Tanger", sequence: 1, plannedArrivalAt: null },
      { siteId: "casablanca", destination: "Casablanca", sequence: 2, plannedArrivalAt: null },
    ],
    status: "completed",
    createdAt: new Date("2026-08-01T08:00:00Z"),
    updatedAt: new Date("2026-08-02T08:00:00Z"),
    ...overrides,
  };
}

test("completed trips are grouped into reusable ordered route history", () => {
  const result = summarizeCompletedTripRoutes([
    trip(),
    trip({ id: "TRIP-2", truck: "TR-22", updatedAt: new Date("2026-08-05T08:00:00Z") }),
    trip({ id: "TRIP-ACTIVE", status: "active" }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].tripCount, 2);
  assert.deepEqual(result[0].destinationSiteIds, ["tanger", "casablanca"]);
  assert.deepEqual(result[0].destinations, ["Tanger", "Casablanca"]);
  assert.deepEqual(result[0].trucks, ["TR-17", "TR-22"]);
  assert.equal(result[0].lastCompletedAt.toISOString(), "2026-08-05T08:00:00.000Z");
});

test("different stop order remains a different historical route", () => {
  const reversed = trip({
    id: "TRIP-REVERSED",
    stops: [
      { siteId: "casablanca", destination: "Casablanca", sequence: 1, plannedArrivalAt: null },
      { siteId: "tanger", destination: "Tanger", sequence: 2, plannedArrivalAt: null },
    ],
  });
  const result = summarizeCompletedTripRoutes([trip(), reversed]);
  assert.equal(result.length, 2);
});

test("planned, active and empty trips do not become historical routes", () => {
  const result = summarizeCompletedTripRoutes([
    trip({ status: "planned" }),
    trip({ status: "active" }),
    trip({ stops: [] }),
  ]);
  assert.deepEqual(result, []);
});
