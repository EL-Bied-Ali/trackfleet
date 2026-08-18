import assert from "node:assert/strict";
import test from "node:test";
import { matchDeliveryVehicle, normalizeVehicleIdentity, rankVehicleSuggestions } from "../app/lib/vehicle-linking.ts";

const vehicle = (id, name, providerDeviceCode = "") => ({
  id,
  name,
  latitude: 50.8,
  longitude: 4.3,
  speed: 0,
  heading: null,
  address: "",
  updatedAt: Date.now(),
  providerAccountId: "",
  providerAccountDescription: "",
  providerDeviceId: id,
  providerDeviceCode,
});

test("normalizes case spaces and punctuation", () => {
  assert.equal(normalizeVehicleIdentity(" TRK-014 "), "trk014");
  assert.equal(normalizeVehicleIdentity("trk 014"), "trk014");
});

test("stable id has priority", () => {
  const m = matchDeliveryVehicle({ sendatrackVehicleId: "send-2", truck: "TRK-014" }, [vehicle("send-1", "TRK-014"), vehicle("send-2", "TRK-014")]);
  assert.equal(m.vehicle?.id, "send-2");
  assert.equal(m.reason, "id");
});

test("links one normalized name", () => {
  const m = matchDeliveryVehicle({ sendatrackVehicleId: "", truck: "trk 014" }, [vehicle("send-1", "TRK-014")]);
  assert.equal(m.vehicle?.id, "send-1");
  assert.equal(m.reason, "normalized_name");
});

test("refuses ambiguous normalized name", () => {
  const m = matchDeliveryVehicle({ sendatrackVehicleId: "", truck: "TRK 014" }, [vehicle("send-1", "TRK-014"), vehicle("send-2", "TRK 014")]);
  assert.equal(m.vehicle, null);
  assert.equal(m.reason, "ambiguous");
});

test("does not fuzzy match different number", () => {
  const m = matchDeliveryVehicle({ sendatrackVehicleId: "", truck: "TRK-14" }, [vehicle("send-1", "TRK-014"), vehicle("send-2", "TRK-140")]);
  assert.equal(m.vehicle, null);
});

test("recovers an old shared DeviceCode only when truck name disambiguates it", () => {
  const vehicles = [vehicle("v3", "2-BKL-255", "fmb120"), vehicle("v4", "7660-B-72", "fmb120")];
  const match = matchDeliveryVehicle({ sendatrackVehicleId: "fmb120", truck: "7660 B 72" }, vehicles);
  assert.equal(match.vehicle?.id, "v4");
  assert.equal(match.reason, "normalized_name");
});

test("never guesses between vehicles that share a legacy DeviceCode", () => {
  const vehicles = [vehicle("v3", "2-BKL-255", "fmb120"), vehicle("v4", "7660-B-72", "fmb120")];
  const match = matchDeliveryVehicle({ sendatrackVehicleId: "fmb120", truck: "unknown truck" }, vehicles);
  assert.equal(match.vehicle, null);
  assert.equal(match.reason, "ambiguous");
});

test("a stale provider id can recover through one exact current truck name", () => {
  const match = matchDeliveryVehicle({ sendatrackVehicleId: "old-id", truck: "TRK-014" }, [vehicle("v14", "TRK-014")]);
  assert.equal(match.vehicle?.id, "v14");
  assert.equal(match.reason, "normalized_name");
});

test("manual search tolerates leading zero differences without changing auto-link rules", () => {
  const vehicles = [vehicle("send-1", "TRK-014"), vehicle("send-2", "TRK-140")];
  const suggestions = rankVehicleSuggestions("trk 14", vehicles);
  assert.equal(suggestions[0]?.id, "send-1");
  assert.equal(matchDeliveryVehicle({ sendatrackVehicleId: "", truck: "trk 14" }, vehicles).vehicle, null);
});

test("unassigned parcel never auto-links to a provider vehicle", async () => {
  const { matchDeliveryVehicle } = await import("../app/lib/vehicle-linking.ts");
  const { UNASSIGNED_TRUCK } = await import("../app/lib/delivery-vehicle-choice.ts");
  const match = matchDeliveryVehicle({ truck: UNASSIGNED_TRUCK, sendatrackVehicleId: "" }, [vehicle("v1", "Unassigned")]);
  assert.equal(match.vehicle, null);
});
