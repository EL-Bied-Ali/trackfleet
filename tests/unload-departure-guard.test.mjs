import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const serverAutomation = await readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8");

test("unloading dwell cannot start while a delivery is still loading", () => {
  assert.match(serverAutomation, /insideArrivalZone = delivery\.status !== "Loading"/);
  assert.match(serverAutomation, /positionAgeMinutes <= 30/);
  assert.match(serverAutomation, /distanceToDestinationKm <= radiusKm/);
  assert.match(serverAutomation, /delivery\.speed \?\? 0\) <= 5/);
});
