import assert from "node:assert/strict";
import test from "node:test";
import { deliveredAtFromEvents, detectDeliveryEvents } from "../app/lib/delivery-events.ts";

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

test("deliveredAtFromEvents finds the automatic arrival timestamp", () => {
  const arrivedAt = new Date("2026-08-20T09:00:00.000Z");
  assert.equal(deliveredAtFromEvents([
    { type: "DEPARTED", createdAt: new Date("2026-08-16T12:00:00.000Z") },
    { type: "ARRIVED", createdAt: arrivedAt },
  ])?.toISOString(), arrivedAt.toISOString());
});

test("deliveredAtFromEvents finds the manual completion timestamp", () => {
  const deliveredAt = new Date("2026-08-20T09:00:00.000Z");
  assert.equal(deliveredAtFromEvents([
    { type: "ARRIVED_AT_SITE", createdAt: new Date("2026-08-19T09:00:00.000Z") },
    { type: "MANUAL_DELIVERED", createdAt: deliveredAt },
  ])?.toISOString(), deliveredAt.toISOString());
});

test("deliveredAtFromEvents returns null when the delivery hasn't arrived", () => {
  assert.equal(deliveredAtFromEvents([
    { type: "DEPARTED", createdAt: new Date("2026-08-16T12:00:00.000Z") },
    { type: "PROGRESS_50", createdAt: new Date("2026-08-17T12:00:00.000Z") },
  ]), null);
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
