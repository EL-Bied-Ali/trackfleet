import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { rotatedVehicleBatch } from "../app/lib/fleet-tick-rotation.ts";

const automationSource = await readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8");
const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

function vehicles(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `vehicle-${index}` }));
}

const tickIntervalMs = 5 * 60_000;

test("below the batch threshold, every tick processes the whole fleet -- no behavior change at today's scale", () => {
  const fleet = vehicles(10);
  const now = Date.now();
  for (let tick = 0; tick < 5; tick += 1) {
    const batch = rotatedVehicleBatch(fleet, now + tick * tickIntervalMs);
    assert.equal(batch.length, fleet.length, `tick ${tick} should include the whole fleet`);
  }
});

test("above the threshold, a single tick only processes a bounded subset", () => {
  const fleet = vehicles(25);
  const batch = rotatedVehicleBatch(fleet, Date.now());
  assert.ok(batch.length < fleet.length, "a single tick must not process the entire large fleet at once");
  assert.ok(batch.length > 0, "a tick must still process something");
});

test("the same moment always produces the same batch -- retries within one tick don't skew who gets processed", () => {
  const fleet = vehicles(25);
  const now = Date.now();
  const first = rotatedVehicleBatch(fleet, now).map((vehicle) => vehicle.id);
  const second = rotatedVehicleBatch(fleet, now).map((vehicle) => vehicle.id);
  assert.deepEqual(first, second);
});

test("over a full rotation cycle, every vehicle gets processed at least once -- nobody is left behind permanently", () => {
  const fleet = vehicles(37);
  const batchCount = Math.ceil(fleet.length / 10);
  const seen = new Set();
  for (let tick = 0; tick < batchCount; tick += 1) {
    for (const vehicle of rotatedVehicleBatch(fleet, Date.now() + tick * tickIntervalMs)) seen.add(vehicle.id);
  }
  assert.equal(seen.size, fleet.length, "every vehicle must appear in at least one batch across a full cycle");
});

test("different ticks generally rotate through different subsets rather than repeating the same one", () => {
  const fleet = vehicles(25);
  const now = Date.now();
  const tickA = rotatedVehicleBatch(fleet, now).map((vehicle) => vehicle.id).sort();
  const tickB = rotatedVehicleBatch(fleet, now + tickIntervalMs).map((vehicle) => vehicle.id).sort();
  assert.notDeepEqual(tickA, tickB, "consecutive ticks should not process the identical subset");
});

test("rotation only applies to the scheduled automation tick, never to a dispatcher's own live dashboard", () => {
  // A human actively looking at their map must always see the full, current
  // fleet -- rotation exists purely to bound the *background* tick's
  // subrequest cost as fleet size grows, not to ever show a dispatcher a
  // stale/partial view of their own trucks.
  assert.match(automationSource, /const rotatedSnapshot = \{ \.\.\.snapshot, vehicles: rotatedVehicleBatch\(snapshot\.vehicles\) \};/);
  assert.match(automationSource, /const aliasedSnapshot = await applyVehicleAliases\(rotatedSnapshot, companyId\);/);
  assert.match(automationSource, /snapshot: aliasedSnapshot,/);
  assert.doesNotMatch(deliveriesRoute, /rotatedVehicleBatch/);
});
