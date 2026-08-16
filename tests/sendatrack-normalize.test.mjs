import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeSendatrackFleet } from "../app/lib/sendatrack-normalize.ts";

const fixtureUrl = new URL("./fixtures/sendatrack-fleet.sample.json", import.meta.url);

test("keeps six real vehicles and ignores nested v3/v4 GPS event rows", async () => {
  const payload = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const { vehicles, diagnostics } = normalizeSendatrackFleet(payload);

  assert.equal(vehicles.length, 6);
  assert.deepEqual(vehicles.map((vehicle) => vehicle.name), [
    "TRUCK-01",
    "TRUCK-02",
    "TRUCK-03",
    "TRUCK-04",
    "TRUCK-05",
    "TRUCK-06",
  ]);
  assert.equal(diagnostics.syntheticRows, 2);
  assert.equal(diagnostics.finalVehicles, 6);
  assert.ok(diagnostics.normalizedRows >= 8);
});
