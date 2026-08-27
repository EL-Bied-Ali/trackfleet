import test from "node:test";
import assert from "node:assert/strict";
import { publicTrackingIsActive, publicTrackingTokenIsValid, trackingExpiresAt } from "../app/lib/tracking-access.ts";

test("accepts only the private 24-character Base64URL tracking token shape", () => {
  assert.equal(publicTrackingTokenIsValid("AbCdEf0123456789_-xyZ123"), true);
  assert.equal(publicTrackingTokenIsValid("short"), false);
  assert.equal(publicTrackingTokenIsValid("AbCdEf0123456789_-xyZ12+"), false);
  assert.equal(publicTrackingTokenIsValid("AbCdEf0123456789_-xyZ1234"), false);
});

test("expires a tracking link seven days after planned arrival", () => {
  const plannedArrivalAt = new Date("2026-08-20T12:00:00.000Z");
  const createdAt = new Date("2026-08-16T12:00:00.000Z");
  assert.equal(trackingExpiresAt({ plannedArrivalAt, createdAt }).toISOString(), "2026-08-27T12:00:00.000Z");
  assert.equal(publicTrackingIsActive({ plannedArrivalAt, createdAt }, new Date("2026-08-27T11:59:59.000Z")), true);
  assert.equal(publicTrackingIsActive({ plannedArrivalAt, createdAt }, new Date("2026-08-27T12:00:01.000Z")), false);
});

test("legacy deliveries without planned arrival stay available for thirty days", () => {
  const createdAt = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(trackingExpiresAt({ plannedArrivalAt: null, createdAt }).toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(publicTrackingIsActive({ plannedArrivalAt: null, createdAt }, new Date("2026-08-30T23:59:59.000Z")), true);
  assert.equal(publicTrackingIsActive({ plannedArrivalAt: null, createdAt }, new Date("2026-09-01T00:00:00.000Z")), false);
});

test("a real arrival cuts the link short of the generic post-planned-arrival window", () => {
  const plannedArrivalAt = new Date("2026-08-20T12:00:00.000Z");
  const createdAt = new Date("2026-08-16T12:00:00.000Z");
  // Arrived two days early -- without deliveredAt the link would stay open
  // until 2026-08-27, a full week past the *planned* date.
  const deliveredAt = new Date("2026-08-18T09:00:00.000Z");
  assert.equal(trackingExpiresAt({ plannedArrivalAt, createdAt, deliveredAt }).toISOString(), "2026-08-20T09:00:00.000Z");
  assert.equal(publicTrackingIsActive({ plannedArrivalAt, createdAt, deliveredAt }, new Date("2026-08-20T08:59:59.000Z")), true);
  assert.equal(publicTrackingIsActive({ plannedArrivalAt, createdAt, deliveredAt }, new Date("2026-08-20T09:00:01.000Z")), false);
});

test("deliveredAt never extends the link past the generic window", () => {
  // Delivered very late, close to when the generic post-planned-arrival
  // window would already close -- the 48h post-arrival grace would push
  // past that, so the tighter (generic) bound must win instead.
  const plannedArrivalAt = new Date("2026-08-20T12:00:00.000Z");
  const createdAt = new Date("2026-08-16T12:00:00.000Z");
  const deliveredAt = new Date("2026-08-26T00:00:00.000Z");
  assert.equal(trackingExpiresAt({ plannedArrivalAt, createdAt, deliveredAt }).toISOString(), "2026-08-27T12:00:00.000Z");
});
