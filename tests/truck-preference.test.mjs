import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { truckPreferenceKey, resolvePreferredTruck } from "../app/lib/truck-preference.ts";

const page = fs.readFileSync("app/page.tsx", "utf8");

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

test("the creation form's remembered truck never silently re-defaults to one already In transit", () => {
  // Regression: new deliveries kept auto-defaulting to the last-used truck
  // even when it had since departed on other active work, capturing that
  // truck's live (non-zero) GPS position as this new delivery's baseline
  // with no conscious choice by the dispatcher. A truck still "Loading" at
  // origin is deliberately NOT excluded -- that's the normal multi-parcel
  // per-truck workflow.
  assert.match(page, /delivery\.status === "In transit" && delivery\.sendatrackVehicleId/);
  assert.match(page, /resolvePreferredTruck\(window\.localStorage\.getItem\(truckPreferenceKey\(company\)\), integration\.vehicles\.map\(\(vehicle\) => vehicle\.id\)\.filter\(\(id\) => !busyVehicleIds\.has\(id\)\)\)/);
});
