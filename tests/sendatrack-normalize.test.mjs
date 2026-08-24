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

test("preserves an explicit legacy vehicle id and exposes logical Device separately", () => {
  const vehicle = normalizeSendatrackVehicle({
    id_Vehicle: 101,
    Account: "legacy-account",
    DeviceCode: "fmb120",
    Device: "v11",
    Device_desc: "Truck 11",
    lastValidLatitude: 35.7,
    lastValidLongitude: -5.8,
    Timestamp: 1_700_000_000,
  });

  assert.ok(vehicle);
  assert.equal(vehicle.id, "101");
  assert.equal(vehicle.providerAccountId, "legacy-account");
  assert.equal(vehicle.providerDeviceId, "v11");
  assert.equal(vehicle.providerDeviceCode, "fmb120");
});

test("uses logical Device rather than shared DeviceCode when no explicit vehicle id exists", () => {
  const first = normalizeSendatrackVehicle({
    DeviceCode: "fmb920",
    Device: "v17",
    Device_desc: "Truck 17",
    GPSPoint_lat: 35.7,
    GPSPoint_lon: -5.8,
    Timestamp: 1_700_000_000,
  });
  const second = normalizeSendatrackVehicle({
    DeviceCode: "fmb920",
    Device: "v18",
    Device_desc: "Truck 18",
    GPSPoint_lat: 35.8,
    GPSPoint_lon: -5.9,
    Timestamp: 1_700_000_100,
  });

  assert.ok(first && second);
  assert.equal(first.id, "v17");
  assert.equal(second.id, "v18");
  assert.notEqual(first.id, second.id);
  assert.equal(first.providerDeviceCode, "fmb920");
  assert.equal(second.providerDeviceCode, "fmb920");
});

test("collapses two rows that share the same canonical id even when their names differ, so the same physical truck can't get two markers under the same truck number", () => {
  const { vehicles } = normalizeSendatrackFleet([
    {
      id: "v6",
      Device_desc: "TRUCK-06",
      lastValidLatitude: 35.7,
      lastValidLongitude: -5.8,
      Timestamp: 1_700_000_000,
    },
    {
      id: "v6",
      // A stale/nested variant of the same device with a differently
      // formatted name -- must still collapse to one row by id, since the
      // name-based dedup pass alone would let both through.
      Device_desc: "Truck 06 (v6)",
      lastValidLatitude: 35.71,
      lastValidLongitude: -5.81,
      Timestamp: 1_700_000_100,
    },
  ]);

  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].id, "v6");
  // Keeps the newer of the two colliding rows.
  assert.equal(vehicles[0].name, "Truck 06 (v6)");
});

test("propagates a parent Account while retaining a Device suitable for OpenGTS history", () => {
  const { vehicles } = normalizeSendatrackFleet({
    Account: "legacy-parent-account",
    DeviceList: [{
      DeviceCode: "device-17",
      Device: "v17",
      Device_desc: "Truck 17",
      GPSPoint_lat: 35.7,
      GPSPoint_lon: -5.8,
      Timestamp: 1_700_000_000,
    }],
  });

  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].id, "v17");
  assert.equal(vehicles[0].providerAccountId, "legacy-parent-account");
  assert.equal(vehicles[0].providerDeviceId, "v17");
  assert.equal(vehicles[0].providerDeviceCode, "device-17");
});
