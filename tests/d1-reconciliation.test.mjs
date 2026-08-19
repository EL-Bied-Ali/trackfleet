import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/d1-reconciliation.ts", "utf8");
const route = fs.readFileSync("app/api/storage/reconcile/route.ts", "utf8");

test("D1 reconciliation is bounded and batched", () => {
  assert.match(source, /const maxCompanies = 50;/);
  assert.match(source, /const maxTripsPerCompany = 500;/);
  assert.match(source, /const maxEtaPerDelivery = 200;/);
  assert.match(source, /const d1BatchSize = 50;/);
  assert.match(source, /const maxActiveSessions = 1000;/);
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

test("reconciliation endpoint requires the cron bearer secret", () => {
  assert.match(route, /runtimeEnv\.CRON_SECRET\?\.trim\(\)/);
  assert.match(route, /authorization/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 401/);
  assert.match(route, /reconcileD1Standby\(\)/);
});
