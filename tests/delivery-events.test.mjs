import assert from "node:assert/strict";
import test from "node:test";
import { detectDeliveryEvents } from "../app/lib/delivery-events.ts";

test("detects departure and crossed progress milestones exactly once per transition", () => {
  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "Loading",
    nextStatus: "In transit",
    previousProgress: 0,
    nextProgress: 52,
    distanceToDestinationKm: 1200,
    positionAgeMinutes: 2,
  }), ["DEPARTED", "PROGRESS_25", "PROGRESS_50"]);
});

test("does not emit a milestone when already past it", () => {
  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "In transit",
    nextStatus: "In transit",
    previousProgress: 52,
    nextProgress: 54,
    distanceToDestinationKm: 1100,
    positionAgeMinutes: 2,
  }), []);
});

test("near destination is based on physical distance, not trip percentage", () => {
  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "In transit",
    nextStatus: "In transit",
    previousProgress: 88,
    nextProgress: 92,
    distanceToDestinationKm: 120,
    positionAgeMinutes: 1,
  }), []);

  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "In transit",
    nextStatus: "In transit",
    previousProgress: 70,
    nextProgress: 71,
    distanceToDestinationKm: 8,
    positionAgeMinutes: 1,
    arrivalRadiusKm: 0.5,
  }), ["NEAR_DESTINATION"]);
});

test("arrival remains separate from the near-destination alert", () => {
  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "In transit",
    nextStatus: "Delivered",
    previousProgress: 98,
    nextProgress: 100,
    distanceToDestinationKm: 0.4,
    positionAgeMinutes: 1,
    arrivalRadiusKm: 0.5,
  }), ["ARRIVED"]);
});

test("marks stale GPS for internal attention", () => {
  assert.deepEqual(detectDeliveryEvents({
    previousStatus: "In transit",
    nextStatus: "In transit",
    previousProgress: 40,
    nextProgress: 40,
    distanceToDestinationKm: 1500,
    positionAgeMinutes: 45,
  }), ["GPS_STALE"]);
});
