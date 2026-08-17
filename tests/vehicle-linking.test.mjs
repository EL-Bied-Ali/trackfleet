import assert from "node:assert/strict";
import test from "node:test";
import { matchDeliveryVehicle, normalizeVehicleIdentity, rankVehicleSuggestions } from "../app/lib/vehicle-linking.ts";
const vehicle = (id, name) => ({ id, name, latitude: 50.8, longitude: 4.3, speed: 0, updatedAt: Date.now() });
test("normalizes case spaces and punctuation", () => { assert.equal(normalizeVehicleIdentity(" TRK-014 "), "trk014"); assert.equal(normalizeVehicleIdentity("trk 014"), "trk014"); });
test("stable id has priority", () => { const m=matchDeliveryVehicle({sendatrackVehicleId:"send-2",truck:"TRK-014"},[vehicle("send-1","TRK-014"),vehicle("send-2","TRK-014")]); assert.equal(m.vehicle?.id,"send-2"); assert.equal(m.reason,"id"); });
test("links one normalized name", () => { const m=matchDeliveryVehicle({sendatrackVehicleId:"",truck:"trk 014"},[vehicle("send-1","TRK-014")]); assert.equal(m.vehicle?.id,"send-1"); assert.equal(m.reason,"normalized_name"); });
test("refuses ambiguous normalized name", () => { const m=matchDeliveryVehicle({sendatrackVehicleId:"",truck:"TRK 014"},[vehicle("send-1","TRK-014"),vehicle("send-2","TRK 014")]); assert.equal(m.vehicle,null); assert.equal(m.reason,"ambiguous"); });
test("does not fuzzy match different number", () => { const m=matchDeliveryVehicle({sendatrackVehicleId:"",truck:"TRK-14"},[vehicle("send-1","TRK-014"),vehicle("send-2","TRK-140")]); assert.equal(m.vehicle,null); });

test("manual search tolerates leading zero differences without changing auto-link rules", () => {
  const vehicles = [vehicle("send-1", "TRK-014"), vehicle("send-2", "TRK-140")];
  const suggestions = rankVehicleSuggestions("trk 14", vehicles);
  assert.equal(suggestions[0]?.id, "send-1");
  assert.equal(matchDeliveryVehicle({ sendatrackVehicleId: "", truck: "trk 14" }, vehicles).vehicle, null);
});


test("unassigned parcel never auto-links to a provider vehicle", async () => {
  const { matchDeliveryVehicle } = await import("../app/lib/vehicle-linking.ts");
  const { UNASSIGNED_TRUCK } = await import("../app/lib/delivery-vehicle-choice.ts");
  const match = matchDeliveryVehicle({ truck: UNASSIGNED_TRUCK, sendatrackVehicleId: "" }, [{ id: "v1", name: "Unassigned", latitude: 0, longitude: 0, speed: 0, updatedAt: Date.now() }]);
  assert.equal(match.vehicle, null);
});
