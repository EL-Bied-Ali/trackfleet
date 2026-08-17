import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRouteHistory } from "../app/lib/route-history.ts";
import { estimateArrival } from "../app/lib/eta-estimator.ts";

function observation(tripInstanceId, speed, source = "observed-pace", offset = 0) {
  return {
    deliveryId: `D-${tripInstanceId}`,
    routeTemplateId: "ROUTE-ABC",
    tripInstanceId,
    destinationSiteId: "casablanca",
    positionAt: new Date(1_700_000_000_000 + offset),
    estimatedArrivalAt: new Date(1_700_010_000_000 + offset),
    plannedArrivalAt: null,
    delayMinutes: offset / 60_000,
    effectiveSpeedKmh: speed,
    remainingDistanceKm: 500,
    progress: 50,
    confidence: "medium",
    source,
    createdAt: new Date(1_700_000_000_000 + offset),
  };
}

test("many GPS samples from one trip do not count as many historical trips", () => {
  const stats = summarizeRouteHistory([
    observation("TRIP-1", 48, "observed-pace", 1),
    observation("TRIP-1", 52, "observed-pace", 2),
    observation("TRIP-1", 50, "observed-pace", 3),
  ]);
  assert.equal(stats.tripCount, 1);
  assert.equal(stats.medianEffectiveSpeedKmh, 50);
  assert.equal(stats.usableEffectiveSpeedKmh, null);
});

test("route history becomes usable after five distinct observed trips", () => {
  const stats = summarizeRouteHistory([
    observation("TRIP-1", 45),
    observation("TRIP-2", 50),
    observation("TRIP-3", 55),
    observation("TRIP-4", 60),
    observation("TRIP-5", 65),
    observation("TRIP-X", 55, "baseline-model"),
  ]);
  assert.equal(stats.tripCount, 5);
  assert.equal(stats.medianEffectiveSpeedKmh, 55);
  assert.equal(stats.usableEffectiveSpeedKmh, 55);
});

test("historical route pace is used only as the starting ETA baseline", () => {
  const eta = estimateArrival({
    remainingDistanceKm: 550,
    completedDistanceKm: 20,
    departedAt: new Date("2026-08-17T08:00:00Z"),
    lastPositionAt: new Date("2026-08-17T09:00:00Z"),
    plannedArrivalAt: null,
    historicalEffectiveSpeedKmh: 50,
    historicalTripCount: 7,
  });
  assert.equal(eta.source, "route-history");
  assert.equal(eta.effectiveSpeedKmh, 50);
  assert.equal(eta.confidence, "medium");
});

test("current observed pace overrides route history once enough live distance exists", () => {
  const eta = estimateArrival({
    remainingDistanceKm: 500,
    completedDistanceKm: 150,
    departedAt: new Date("2026-08-17T06:00:00Z"),
    lastPositionAt: new Date("2026-08-17T09:00:00Z"),
    plannedArrivalAt: null,
    historicalEffectiveSpeedKmh: 60,
    historicalTripCount: 9,
  });
  assert.equal(eta.source, "observed-pace");
  assert.equal(eta.effectiveSpeedKmh, 50);
});
