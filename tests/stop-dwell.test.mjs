import assert from "node:assert/strict";
import test from "node:test";
import { summarizeStopDwell } from "../app/lib/stop-dwell.ts";

const site = { latitude: 33.5731, longitude: -7.5898, arrivalRadiusKm: 1 };

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
