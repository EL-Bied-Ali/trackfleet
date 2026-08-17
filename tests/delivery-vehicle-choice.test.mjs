import assert from "node:assert/strict";
import test from "node:test";
import { isUnassignedVehicle, resolveCreationVehicle, UNASSIGNED_TRUCK, UNASSIGNED_VEHICLE_ID } from "../app/lib/delivery-vehicle-choice.ts";

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


test("new parcel can remain unassigned until a real truck is confirmed", () => {
  const choice = resolveCreationVehicle({ selectedVehicleId: UNASSIGNED_VEHICLE_ID, vehicles: [{ id: "gps-1", name: "TRK-1" }] });
  assert.equal(choice.source, "unassigned");
  assert.equal(choice.truck, UNASSIGNED_TRUCK);
  assert.equal(choice.sendatrackVehicleId, "");
  assert.equal(isUnassignedVehicle(choice), true);
});

test("blank offline truck stays unassigned instead of inventing a vehicle", () => {
  const choice = resolveCreationVehicle({ manualTruck: "", selectedVehicleId: "", vehicles: [] });
  assert.equal(choice.source, "unassigned");
  assert.equal(isUnassignedVehicle(choice), true);
});
