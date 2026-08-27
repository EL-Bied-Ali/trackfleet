import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { groupPositionsByTrip, summarizeStopDwell, summarizeStopDwellFromGroupedTrips } from "../app/lib/stop-dwell.ts";

const site = { latitude: 33.5731, longitude: -7.5898, arrivalRadiusKm: 1 };
const otherSite = { latitude: 50.8503, longitude: 4.3517, arrivalRadiusKm: 1 };

function point(trip, minutes, latitude, longitude) {
  return {
    companyId: "company-a",
    routeTemplateId: "ROUTE-A",
    tripInstanceId: trip,
    vehicleId: "veh-1",
    positionAt: new Date(Date.UTC(2026, 7, 17, 10, minutes)),
    latitude,
    longitude,
    speed: 0,
    createdAt: new Date(Date.UTC(2026, 7, 17, 10, minutes)),
  };
}

function visit(trip, entryMinute, exitMinute) {
  return [
    point(trip, entryMinute - 5, 33.60, -7.65),
    point(trip, entryMinute, 33.5731, -7.5898),
    point(trip, exitMinute, 33.5732, -7.5897),
    point(trip, exitMinute + 5, 33.60, -7.65),
  ];
}

test("a stop visit is measured only after GPS enters and exits the geofence", () => {
  const stats = summarizeStopDwell(visit("TRIP-1", 10, 40), site);
  assert.equal(stats.tripCount, 1);
  assert.equal(stats.medianMinutes, 35);
  assert.equal(stats.usableMinutes, null);
});

test("three distinct trips make agency dwell history usable", () => {
  const stats = summarizeStopDwell([
    ...visit("TRIP-1", 10, 30),
    ...visit("TRIP-2", 10, 40),
    ...visit("TRIP-3", 10, 50),
  ], site);
  assert.equal(stats.tripCount, 3);
  assert.equal(stats.medianMinutes, 35);
  assert.equal(stats.usableMinutes, 35);
});

test("an unfinished stay inside the agency is never learned as completed dwell", () => {
  const stats = summarizeStopDwell([
    point("TRIP-1", 0, 33.60, -7.65),
    point("TRIP-1", 5, 33.5731, -7.5898),
    point("TRIP-1", 30, 33.5731, -7.5898),
  ], site);
  assert.equal(stats.tripCount, 0);
  assert.equal(stats.usableMinutes, null);
});

test("grouping positions once and checking many sites against it gives the exact same answer as summarizeStopDwell per site -- the optimization behind learnedStopMinutes in app/api/deliveries/route.ts", () => {
  // Reported live: that endpoint hit Cloudflare's Worker CPU time limit.
  // summarizeStopDwell used to re-group and re-sort the entire position
  // history once per known company site (up to 20,000 positions, ~15
  // sites) even though grouping/sorting doesn't depend on the site being
  // checked. groupPositionsByTrip does that work once; this proves the
  // split produces identical results, not just faster ones.
  const positions = [
    ...visit("TRIP-1", 10, 30),
    ...visit("TRIP-2", 10, 40),
    ...visit("TRIP-3", 10, 50),
  ];
  const grouped = groupPositionsByTrip(positions);
  const viaGrouping = summarizeStopDwellFromGroupedTrips(grouped, site);
  const viaSingleCall = summarizeStopDwell(positions, site);
  assert.deepEqual(viaGrouping, viaSingleCall);
  assert.equal(viaGrouping.tripCount, 3);
  assert.equal(viaGrouping.usableMinutes, 35);

  // The same grouped map, reused for a completely different site's
  // coordinates, must not see any of the above trips (none of these
  // positions ever enter otherSite's geofence).
  const otherSiteStats = summarizeStopDwellFromGroupedTrips(grouped, otherSite);
  assert.equal(otherSiteStats.tripCount, 0);
  assert.equal(otherSiteStats.usableMinutes, null);
});

test("groupPositionsByTrip excludes the given trip instance, matching summarizeStopDwell's own excludeTripInstanceId behavior", () => {
  const positions = [...visit("TRIP-1", 10, 30), ...visit("TRIP-2", 10, 40), ...visit("TRIP-3", 10, 50)];
  const viaGrouping = summarizeStopDwellFromGroupedTrips(groupPositionsByTrip(positions, "TRIP-2"), site);
  const viaSingleCall = summarizeStopDwell(positions, site, 3, "TRIP-2");
  assert.deepEqual(viaGrouping, viaSingleCall);
  assert.equal(viaGrouping.tripCount, 2);
});

test("learnedStopMinutes groups the route's position history once, outside the per-site loop -- not once per site", async () => {
  const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  const learnedStopMinutesStart = route.indexOf("async function learnedStopMinutes");
  const forSiteLoopStart = route.indexOf("for (const site of sites)", learnedStopMinutesStart);
  const groupCallIndex = route.indexOf("groupPositionsByTrip(positions, currentTripInstanceId)", learnedStopMinutesStart);
  assert.ok(learnedStopMinutesStart >= 0 && forSiteLoopStart > learnedStopMinutesStart, "learnedStopMinutes must contain the per-site loop");
  assert.ok(groupCallIndex >= 0 && groupCallIndex < forSiteLoopStart, "grouping must happen before the per-site loop, not inside it");
  assert.match(route, /summarizeStopDwellFromGroupedTrips\(groupedTrips, \{ latitude: site\.latitude, longitude: site\.longitude, arrivalRadiusKm: site\.arrivalRadiusKm \}, 3\)/);
});
