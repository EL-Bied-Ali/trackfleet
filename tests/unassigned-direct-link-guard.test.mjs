import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../app/api/deliveries/link-vehicle/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("unassigned parcels cannot bypass trip assignment through vehicle linking", () => {
  assert.match(api, /isUnassignedVehicle\(existingDelivery\)/);
  assert.match(api, /trip_assignment_required/);
  assert.match(api, /status: 409/);
});

test("dashboard directs unassigned parcels to planned trips instead of direct GPS linking", () => {
  assert.match(page, /Affectez d’abord ce colis à un voyage planifié/);
  assert.match(page, /Confirmer ce voyage/);
  assert.doesNotMatch(page, /Choisir un autre camion/);
  assert.match(page, /Associer le GPS du véhicule/);
});
