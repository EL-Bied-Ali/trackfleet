import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../app/api/fleet/history/route.ts", import.meta.url), "utf8");

test("fleet history requires a company session and scopes reads to that company", () => {
  assert.match(route, /getCompanySession\(request\)/);
  assert.match(route, /authentication_required/);
  assert.match(route, /store\.listFleetPositions\(session\.companyId, vehicleId/);
  assert.match(route, /siteStore\.listForCompany\(session\.companyId\)/);
});

test("fleet history is bounded and never exposes provider credentials or companyId in point JSON", () => {
  assert.match(route, /MAX_WINDOW_MS = 14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(route, /MAX_LIMIT = 20000/);
  assert.match(route, /window_too_large/);
  const publicPointShape = route.slice(route.indexOf("const points ="), route.indexOf("const stops ="));
  assert.doesNotMatch(publicPointShape, /companyId/);
  assert.doesNotMatch(route, /password|Authorization:|Bearer /i);
});

test("fleet history returns both raw points and reconstructed operational data", () => {
  assert.match(route, /reconstructFleetTrips\(selected, sites\)/);
  assert.match(route, /points,/);
  assert.match(route, /stops,/);
  assert.match(route, /trips,/);
  assert.match(route, /summary:/);
});
