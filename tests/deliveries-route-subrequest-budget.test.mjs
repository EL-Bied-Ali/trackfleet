import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Live production incident, 2026-09-02: GET /api/deliveries started 500ing
// for every dispatcher with "Too many subrequests by single Worker
// invocation" once the real company's trip history grew past ~44 trips.
// Root cause was two redundant per-request DB round trips inside the trip
// completion sweep -- each easily fixable without an extra query at all,
// since the data was already sitting in `rows`/`persistedTrips` from
// earlier in the same request.
const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("the trip-completion sweep no longer queries store.listDeliveryIdsForTrip per trip -- it reuses tripId already present on the deliveries this request already fetched", () => {
  assert.doesNotMatch(route, /store\.listDeliveryIdsForTrip\(/);
  assert.match(route, /deliveryIdsByTripId\.get\(trip\.id\)/);
});

test("route history no longer re-fetches store.listTrips a second time with the same params -- it patches the already-fetched list with this request's own completions", () => {
  const listTripsCalls = route.match(/store\.listTrips\(session\.companyId, 500\)/g) ?? [];
  assert.equal(listTripsCalls.length, 1, "store.listTrips(session.companyId, 500) must be called at most once per request");
  assert.match(route, /allTripsForHistory = justCompletedTripIds\.size === 0 \? persistedTrips/);
});
