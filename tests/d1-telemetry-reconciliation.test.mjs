import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/d1-telemetry-reconciliation.ts", "utf8");
const route = fs.readFileSync("app/api/storage/reconcile-telemetry/route.ts", "utf8");

test("telemetry reconciliation is bounded and batched", () => {
  assert.match(source, /const maxCompanies = 5;/);
  assert.match(source, /const maxFleetPositionsPerCompany = 100;/);
  assert.match(source, /const maxTripPositionsPerCompany = 100;/);
  assert.match(source, /const d1BatchSize = 50;/);
  assert.match(source, /const maxD1StatementsPerPass = 1000;/);
  assert.match(source, /d1_telemetry_reconciliation_budget_exceeded/);
  assert.match(source, /await d1\.batch\(statements\.slice\(index, index \+ d1BatchSize\)\);/);
});

test("fleet and trip telemetry use idempotent upserts", () => {
  assert.match(source, /ON CONFLICT\(company_id, vehicle_id, position_at\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(company_id, trip_instance_id, position_at\) DO UPDATE SET/);
  assert.match(source, /ORDER BY position_at DESC LIMIT \$\{maxFleetPositionsPerCompany\}/);
  assert.match(source, /ORDER BY position_at DESC LIMIT \$\{maxTripPositionsPerCompany\}/);
});

test("telemetry reconciliation records attempt, success and failure freshness", () => {
  assert.match(source, /'d1_telemetry_reconciliation'/);
  assert.match(source, /last_attempt_at/);
  assert.match(source, /last_success_at/);
  assert.match(source, /last_failure_at/);
});

test("telemetry reconciliation endpoint is protected", () => {
  assert.match(route, /runtimeEnv\.CRON_SECRET\?\.trim\(\)/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 401/);
  assert.match(route, /reconcileD1Telemetry\(\)/);
});
