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
