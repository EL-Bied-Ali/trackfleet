import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/d1-reconciliation.ts", "utf8");
const safeSource = fs.readFileSync("app/lib/d1-reconciliation-safe.ts", "utf8");
const route = fs.readFileSync("app/api/storage/reconcile/route.ts", "utf8");

test("D1 reconciliation is bounded and batched", () => {
  assert.match(source, /const maxCompanies = 5;/);
  assert.match(source, /const maxTripsPerCompany = 100;/);
  assert.match(source, /const maxEtaPerDelivery = 20;/);
  assert.match(source, /const d1BatchSize = 50;/);
  assert.match(source, /const maxActiveSessions = 200;/);
  assert.match(source, /const maxD1StatementsPerPass = 1000;/);
  assert.match(source, /statements\.length > maxD1StatementsPerPass/);
  assert.match(source, /d1_reconciliation_budget_exceeded/);
  assert.match(source, /await db\.batch\(statements\.slice\(index, index \+ d1BatchSize\)\);/);
});

test("reconciliation repairs authoritative Postgres rows into D1 with upserts", () => {
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(delivery_id, type\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(delivery_id, position_at\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(company_id, id\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(token_hash\) DO UPDATE SET/);
});

test("reconciliation records attempts, successes and failures in D1", () => {
  assert.match(source, /'d1_reconciliation'/);
  assert.match(source, /last_attempt_at/);
  assert.match(source, /last_success_at/);
  assert.match(source, /last_failure_at/);
});

test("safe reconciliation refuses silent coverage truncation before delegating", () => {
  assert.match(safeSource, /D1_RECONCILIATION_MAX_COMPANIES = 5/);
  assert.match(safeSource, /D1_RECONCILIATION_MAX_ACTIVE_SESSIONS = 200/);
  assert.match(safeSource, /d1_reconciliation_coverage_exceeded/);
  assert.match(safeSource, /withoutD1ReadFailover\(\(\) => reconcileD1Standby\(\)\)/);
});

test("reconciliation endpoint requires the cron bearer secret and uses the safe entrypoint", () => {
  assert.match(route, /runtimeEnv\.CRON_SECRET\?\.trim\(\)/);
  assert.match(route, /authorization/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 401/);
  assert.match(route, /reconcileD1StandbySafely\(\)/);
  assert.doesNotMatch(route, /reconcileD1Standby\(\)/);
});
