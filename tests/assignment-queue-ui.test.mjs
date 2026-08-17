import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dashboard keeps unassigned parcels in a dedicated queue", () => {
  assert.match(page, /unassignedDeliveries/);
  assert.match(page, /Colis à affecter/);
});

test("planned trip suggestion requires explicit operator confirmation", () => {
  assert.match(page, /suggestPlannedTrip/);
  assert.match(page, /Confirmer ce voyage/);
  assert.match(page, /assignSuggestedTrip/);
  assert.match(page, /\/api\/deliveries\/assign-trip/);
});

test("unassigned parcels cannot bypass trip selection by choosing a truck directly", () => {
  assert.doesNotMatch(page, /Choisir un autre camion/);
  assert.match(page, /Voir le colis/);
  assert.match(page, /Affectez d’abord ce colis à un voyage planifié/);
});
