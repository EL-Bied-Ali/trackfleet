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

test("operator can still choose another truck instead of accepting the suggestion", () => {
  assert.match(page, /Choisir un autre camion/);
  assert.match(page, /setVehicleLinkOpen\(true\)/);
});
