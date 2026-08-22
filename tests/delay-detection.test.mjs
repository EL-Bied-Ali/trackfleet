import test from "node:test";
import assert from "node:assert/strict";
import { shouldDetectDelay } from "../app/lib/delay-detection.ts";

const baseEta = {
  estimatedArrivalAt: new Date("2026-08-20T18:00:00Z"),
  effectiveSpeedKmh: 50,
  delayMinutes: 90,
  confidence: "medium",
  source: "observed-pace",
};

test("detects a material delay only with medium confidence", () => {
  assert.equal(shouldDetectDelay({ eta: baseEta, delivered: false, alreadyDetected: false }), true);
  assert.equal(shouldDetectDelay({ eta: { ...baseEta, confidence: "low" }, delivered: false, alreadyDetected: false }), false);
});

test("does not detect small, delivered, or duplicate delays", () => {
  assert.equal(shouldDetectDelay({ eta: { ...baseEta, delayMinutes: 59 }, delivered: false, alreadyDetected: false }), false);
  assert.equal(shouldDetectDelay({ eta: baseEta, delivered: true, alreadyDetected: false }), false);
  assert.equal(shouldDetectDelay({ eta: baseEta, delivered: false, alreadyDetected: true }), false);
});

test("never raises a delay alert for a destination beyond the GPS-tracked leg", () => {
  // A frozen last-known GPS position on an untracked relay leg would produce
  // a huge, meaningless "delay" -- this must be suppressed regardless of how
  // large eta.delayMinutes looks.
  assert.equal(shouldDetectDelay({ eta: baseEta, delivered: false, alreadyDetected: false, finalLegTrackingUnavailable: true }), false);
  assert.equal(shouldDetectDelay({ eta: { ...baseEta, delayMinutes: 100000 }, delivered: false, alreadyDetected: false, finalLegTrackingUnavailable: true }), false);
});
