import assert from "node:assert/strict";
import test from "node:test";
import { truckPreferenceKey, resolvePreferredTruck } from "../app/lib/truck-preference.ts";

test("truck preference is scoped by SENDATRACK account and user", () => {
  assert.notEqual(
    truckPreferenceKey({ account: "ACME", user: "dispatcher-a" }),
    truckPreferenceKey({ account: "ACME", user: "dispatcher-b" }),
  );
});

test("saved truck wins when it's still connected", () => {
  assert.equal(resolvePreferredTruck("vehicle-b", ["vehicle-a", "vehicle-b"]), "vehicle-b");
});

test("falls back to unassigned when the saved truck is no longer connected", () => {
  assert.equal(resolvePreferredTruck("removed", ["vehicle-a", "vehicle-b"]), "");
});

test("falls back to unassigned when nothing was ever saved", () => {
  assert.equal(resolvePreferredTruck(null, ["vehicle-a"]), "");
});
