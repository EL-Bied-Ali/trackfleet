import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dispatcher-only trip history API omits tenant id", () => {
  assert.match(route, /trips: session\.role === "dispatcher" \? tripHistory : \[\]/);
  assert.doesNotMatch(route, /companyId: trip\.companyId,[\s\S]{0,250}trips: tripHistory/);
});

test("the 'Voyages récents' display panel was removed, but trips still feeds the Colis à affecter suggestion feature", () => {
  // See dashboard-role-priority.test.mjs: the display-only recent-trips
  // panel was removed as fleet-ops clutter, but the underlying tripHistory
  // data still has a real consumer (suggestPlannedTrip) and must stay wired.
  assert.doesNotMatch(page, /Voyages récents/);
  assert.match(page, /suggestPlannedTrip\(delivery, trips\)/);
});
