import assert from "node:assert/strict";
import test from "node:test";
import { estimateArrival } from "../app/lib/eta-estimator.ts";

test("uses a low-confidence baseline before enough observed travel", () => {
  const fix = new Date("2026-08-16T12:00:00Z");
  const estimate = estimateArrival({ remainingDistanceKm: 550, completedDistanceKm: 20, departedAt: new Date("2026-08-16T11:30:00Z"), lastPositionAt: fix, plannedArrivalAt: null });
  assert.equal(estimate.source, "baseline-model");
  assert.equal(estimate.confidence, "low");
  assert.equal(estimate.effectiveSpeedKmh, 55);
  assert.equal(estimate.estimatedArrivalAt?.toISOString(), "2026-08-16T22:00:00.000Z");
});

test("uses observed effective pace after enough distance and time", () => {
  const estimate = estimateArrival({
    remainingDistanceKm: 600,
    completedDistanceKm: 600,
    departedAt: new Date("2026-08-16T00:00:00Z"),
    lastPositionAt: new Date("2026-08-16T10:00:00Z"),
    plannedArrivalAt: new Date("2026-08-16T19:00:00Z"),
  });
  assert.equal(estimate.source, "observed-pace");
  assert.equal(estimate.confidence, "medium");
  assert.equal(estimate.effectiveSpeedKmh, 60);
  assert.equal(estimate.estimatedArrivalAt?.toISOString(), "2026-08-16T20:00:00.000Z");
  assert.equal(estimate.delayMinutes, 60);
});

test("adds only future agency service time to the projected arrival", () => {
  const estimate = estimateArrival({
    remainingDistanceKm: 600,
    completedDistanceKm: 600,
    departedAt: new Date("2026-08-16T00:00:00Z"),
    lastPositionAt: new Date("2026-08-16T10:00:00Z"),
    plannedArrivalAt: new Date("2026-08-16T20:00:00Z"),
    futureServiceMinutes: 60,
  });
  assert.equal(estimate.estimatedArrivalAt?.toISOString(), "2026-08-16T21:00:00.000Z");
  assert.equal(estimate.delayMinutes, 60);
});

test("clamps absurd observed pace and keeps the ETA stable", () => {
  const estimate = estimateArrival({
    remainingDistanceKm: 850,
    completedDistanceKm: 1000,
    departedAt: new Date("2026-08-16T08:00:00Z"),
    lastPositionAt: new Date("2026-08-16T10:00:00Z"),
    plannedArrivalAt: null,
  });
  assert.equal(estimate.effectiveSpeedKmh, 85);
  assert.equal(estimate.estimatedArrivalAt?.toISOString(), "2026-08-16T20:00:00.000Z");
});
