import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the active-tours trip-card panel (and its trip-aware key requirement) was removed along with the other fleet-ops display panels", () => {
  // This test used to guard against plan.vehicleKey collisions in the
  // "Tournées actives" panel's React keys -- that whole panel is gone now
  // (see dashboard-role-priority.test.mjs), so there's no longer a
  // stopPlans-driven list of trip cards to key at all.
  assert.doesNotMatch(page, /key=\{activeTourKey\(plan\)\}/);
  assert.doesNotMatch(page, /key=\{plan\.vehicleKey\}/);
});
