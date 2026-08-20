import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canonicalFleetVehicleId, hasPhysicalVehicleName, normalizePhysicalVehicleName, samePhysicalVehicle } from "../app/lib/vehicle-identity.ts";

const automationSource = fs.readFileSync(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8");

test("plate-like vehicle names produce stable physical telemetry ids", () => {
  assert.equal(normalizePhysicalVehicleName(" 18799-B-2 "), "18799b2");
  assert.equal(canonicalFleetVehicleId("18799-B-2", "v7"), "physical:18799b2");
  assert.equal(canonicalFleetVehicleId("18799 B 2", "tk00x"), "physical:18799b2");
  assert.equal(samePhysicalVehicle("18799-B-2", "18799 B 2"), true);
});

test("provider/model-like labels are not mistaken for a physical truck", () => {
  assert.equal(hasPhysicalVehicleName("v7"), false);
  assert.equal(hasPhysicalVehicleName("fmb920"), false);
  assert.equal(canonicalFleetVehicleId("v7", "v7"), "provider:v7");
  assert.equal(canonicalFleetVehicleId("", "TK00X"), "provider:tk00x");
});

test("automation persists canonical ids without changing live delivery provider ids", () => {
  assert.match(automationSource, /vehicleId: canonicalFleetVehicleId\(vehicle\.name, vehicle\.providerDeviceId \|\| vehicle\.id\)/);
  assert.match(automationSource, /vehicleId: canonicalFleetVehicleId\(delivery\.truck, delivery\.sendatrackVehicleId\)/);
  assert.match(automationSource, /sendatrackVehicleId: plan\.sendatrackVehicleId/);
});
