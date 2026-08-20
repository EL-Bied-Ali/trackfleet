import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("dispatch API exposes tenant-safe completed route history", () => {
  assert.match(route, /summarizeCompletedTripRoutes\(allTripsForHistory\)/);
  assert.match(route, /routeHistory: session\.role === "dispatcher" \? routeHistory : \[\]/);
  assert.match(route, /destinationSiteIds: route\.destinationSiteIds/);
  assert.match(route, /destinations: route\.destinations/);
  assert.match(route, /tripCount: route\.tripCount/);
  assert.match(route, /lastCompletedAt: route\.lastCompletedAt\.toISOString\(\)/);
  assert.doesNotMatch(route, /routeHistory[\s\S]{0,500}companyId: route\./);
});
