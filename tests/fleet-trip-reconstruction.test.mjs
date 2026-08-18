import assert from "node:assert/strict";
import test from "node:test";
import { haversineKm, reconstructFleetTrips } from "../app/lib/fleet-trip-reconstruction.ts";

const start = Date.parse("2026-08-18T08:00:00Z");
function point(minute, latitude, longitude, speed = 0, address = "") {
  return {
    companyId: "company-a",
    vehicleId: "v3",
    vehicleName: "2-BKL-255",
    positionAt: new Date(start + minute * 60_000),
    latitude,
    longitude,
    speed,
    heading: null,
    address,
    createdAt: new Date(start + minute * 60_000 + 1000),
  };
}

const sites = [
  { id: "origin", label: "Origin depot", latitude: 50.85, longitude: 4.35, arrivalRadiusKm: 0.5 },
  { id: "destination", label: "Destination depot", latitude: 50.55, longitude: 4.35, arrivalRadiusKm: 0.5 },
];

test("detects two meaningful stops and the trip between them", () => {
  const rows = [
    point(0, 50.85, 4.35, 0, "Origin"), point(5, 50.85, 4.35, 0, "Origin"), point(10, 50.85, 4.35, 0, "Origin"), point(15, 50.85, 4.35, 0, "Origin"), point(20, 50.85, 4.35, 0, "Origin"),
    point(25, 50.80, 4.35, 62), point(30, 50.75, 4.35, 65), point(35, 50.70, 4.35, 61), point(40, 50.65, 4.35, 58), point(45, 50.60, 4.35, 55),
    point(50, 50.55, 4.35, 0, "Destination"), point(55, 50.55, 4.35, 0, "Destination"), point(60, 50.55, 4.35, 0, "Destination"), point(65, 50.55, 4.35, 0, "Destination"), point(70, 50.55, 4.35, 0, "Destination"),
  ];
  const result = reconstructFleetTrips(rows, sites);
  assert.equal(result.stops.length, 2);
  assert.equal(result.stops[0].siteId, "origin");
  assert.equal(result.stops[1].siteId, "destination");
  assert.equal(result.trips.length, 1);
  assert.equal(result.trips[0].originSiteId, "origin");
  assert.equal(result.trips[0].destinationSiteId, "destination");
  assert.ok(result.trips[0].distanceKm > 30);
  assert.equal(result.trips[0].openStart, false);
  assert.equal(result.trips[0].openEnd, false);
});

test("does not promote a short pause into an operational stop", () => {
  const rows = [
    point(0, 50.85, 4.35, 50), point(5, 50.80, 4.35, 50),
    point(10, 50.75, 4.35, 0), point(15, 50.75, 4.35, 0),
    point(20, 50.70, 4.35, 50), point(25, 50.65, 4.35, 50),
  ];
  const result = reconstructFleetTrips(rows);
  assert.equal(result.stops.length, 0);
  assert.equal(result.trips.length, 1);
});

test("sorts and deduplicates provider timestamps before reconstruction", () => {
  const duplicate = point(5, 50.80, 4.35, 40);
  const rows = [point(10, 50.75, 4.35, 40), duplicate, point(0, 50.85, 4.35, 40), { ...duplicate }];
  const result = reconstructFleetTrips(rows);
  assert.equal(result.points.length, 3);
  assert.equal(result.points[0].positionAt.toISOString(), "2026-08-18T08:00:00.000Z");
});

test("ignores impossible GPS jumps in learned distance", () => {
  const rows = [point(0, 50.85, 4.35, 0), point(5, 35.75, -5.83, 0)];
  const result = reconstructFleetTrips(rows);
  assert.equal(result.summary.distanceKm, 0);
  assert.equal(result.summary.discardedJumpCount, 1);
});

test("haversine helper returns a realistic short distance", () => {
  const distance = haversineKm({ latitude: 50.85, longitude: 4.35 }, { latitude: 50.86, longitude: 4.35 });
  assert.ok(distance > 1 && distance < 1.2);
});
