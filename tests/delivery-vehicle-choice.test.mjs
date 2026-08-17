import assert from "node:assert/strict";
import test from "node:test";
import { resolveCreationVehicle } from "../app/lib/delivery-vehicle-choice.ts";

const vehicles = [
  { id: "veh-14", name: "TRK-014" },
  { id: "veh-22", name: "TRK-022" },
];

test("a manual truck overrides the currently selected live vehicle", () => {
  assert.deepEqual(resolveCreationVehicle({ manualTruck: " NEW-099 ", selectedVehicleId: "veh-14", vehicles }), {
    truck: "NEW-099",
    sendatrackVehicleId: "",
    source: "manual",
  });
});

test("a live vehicle keeps its stable SENDATRACK id when no manual truck is entered", () => {
  assert.deepEqual(resolveCreationVehicle({ manualTruck: "", selectedVehicleId: "veh-14", vehicles }), {
    truck: "TRK-014",
    sendatrackVehicleId: "veh-14",
    source: "sendatrack",
  });
});

test("an unknown typed vehicle id never becomes a trusted provider link", () => {
  assert.deepEqual(resolveCreationVehicle({ selectedVehicleId: "TRK-MISSING", vehicles }), {
    truck: "TRK-MISSING",
    sendatrackVehicleId: "",
    source: "manual",
  });
});
