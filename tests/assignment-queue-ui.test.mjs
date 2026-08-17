import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dashboard keeps unassigned parcels in a dedicated queue", () => {
  assert.match(page, /unassignedDeliveries/);
  assert.match(page, /Colis à affecter/);
});

test("suggestion remains review-only and never auto-links", () => {
  assert.match(page, /suggestPlannedTrip/);
  assert.match(page, /Vérifier l’affectation/);
  assert.doesNotMatch(page, /suggestion[\s\S]{0,300}linkSelectedVehicle\(\)/);
});
