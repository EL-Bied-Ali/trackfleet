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
