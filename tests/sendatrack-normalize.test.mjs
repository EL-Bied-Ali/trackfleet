import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeSendatrackFleet, normalizeSendatrackVehicle } from "../app/lib/sendatrack-normalize.ts";

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

test("preserves legacy Account and DeviceCode without changing the existing vehicle id", () => {
  const vehicle = normalizeSendatrackVehicle({
    id_Vehicle: 101,
    Account: "legacy-account",
    DeviceCode: "legacy-device-code",
    Device: "v11",
    Device_desc: "Truck 11",
    lastValidLatitude: 35.7,
    lastValidLongitude: -5.8,
    Timestamp: 1_700_000_000,
  });

  assert.ok(vehicle);
  assert.equal(vehicle.id, "101");
  assert.equal(vehicle.providerAccountId, "legacy-account");
  assert.equal(vehicle.providerDeviceId, "legacy-device-code");
});
