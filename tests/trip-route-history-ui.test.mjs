import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the dashboard no longer renders a separate route-history display panel", () => {
  // The "Routes fréquentes" panel (and its sibling "Tournées actives" /
  // "Voyages récents" panels) was removed as fleet-ops clutter neither the
  // dispatcher nor an agency employee found useful -- see
  // dashboard-role-priority.test.mjs for the replacement coverage.
  assert.doesNotMatch(page, /Routes fréquentes/);
  assert.doesNotMatch(page, /const \[routeHistory, setRouteHistory\]/);
});
