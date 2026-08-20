import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const serverAutomation = await readFile(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8");

test("GPS unloading dwell cannot start while loading; explicit employee confirmation can override it", () => {
  assert.match(serverAutomation, /manuallyConfirmedArrival \|\| delivery\.status !== "Loading"/);
  assert.match(serverAutomation, /positionAgeMinutes <= 30/);
  assert.match(serverAutomation, /distanceToDestinationKm <= radiusKm/);
  assert.match(serverAutomation, /delivery\.speed \?\? 0\) <= 5/);
});
