import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/d1-telemetry-reconciliation.ts", "utf8");
const route = fs.readFileSync("app/api/storage/reconcile-telemetry/route.ts", "utf8");

test("telemetry reconciliation is bounded and batched", () => {
  assert.match(source, /const maxCompanies = 50;/);
  assert.match(source, /const maxFleetPositionsPerCompany = 2000;/);
  assert.match(source, /const maxTripPositionsPerCompany = 2000;/);
  assert.match(source, /const d1BatchSize = 50;/);
  assert.match(source, /await d1\.batch\(statements\.slice\(index, index \+ d1BatchSize\)\);/);
});

test("fleet and trip telemetry use idempotent upserts", () => {
  assert.match(source, /ON CONFLICT\(company_id, vehicle_id, position_at\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(company_id, trip_instance_id, position_at\) DO UPDATE SET/);
  assert.match(source, /ORDER BY position_at DESC LIMIT \$\{maxFleetPositionsPerCompany\}/);
  assert.match(source, /ORDER BY position_at DESC LIMIT \$\{maxTripPositionsPerCompany\}/);
});

test("telemetry reconciliation endpoint is protected", () => {
  assert.match(route, /runtimeEnv\.CRON_SECRET\?\.trim\(\)/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 401/);
  assert.match(route, /reconcileD1Telemetry\(\)/);
});
