import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../app/api/deliveries/link-vehicle/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("vehicle linking now handles both initial assignment and reassignment the same way", () => {
  // Truck assignment moved out of the creation form entirely (too redundant
  // when several unrelated parcels go out on the same truck run -- reported
  // live) in favor of assigning/reassigning any delivery, unassigned or not,
  // directly from the delivery table's per-row truck editor. The previous
  // guard forcing an unassigned delivery through the separate planned-trip
  // system first no longer applies to this endpoint (the trip-suggestion
  // flow below is unaffected and still exists as its own path).
  assert.doesNotMatch(api, /isUnassignedVehicle/);
  assert.doesNotMatch(api, /trip_assignment_required/);
});

test("dashboard directs unassigned parcels to planned trips instead of direct GPS linking", () => {
  assert.match(page, /Affectez d’abord ce colis à un voyage planifié/);
  assert.match(page, /Confirmer ce voyage/);
  assert.doesNotMatch(page, /Choisir un autre camion/);
  assert.match(page, /Associer le GPS du véhicule/);
});
