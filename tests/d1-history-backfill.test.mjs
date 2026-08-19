import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/d1-history-backfill.ts", "utf8");
const route = fs.readFileSync("app/api/storage/backfill-history/route.ts", "utf8");
const schema = fs.readFileSync("scripts/prepare-d1-history-backfill-state.mjs", "utf8");

test("history backfill is bounded and uses stable keyset pagination", () => {
  assert.match(source, /const maxCompaniesPerPass = 3;/);
  assert.match(source, /const pageSize = 10;/);
  assert.match(source, /const maxEtaPerDelivery = 10;/);
  assert.match(source, /const d1BatchSize = 50;/);
  assert.match(source, /const maxD1StatementsPerCompanyPage = 800;/);
  assert.match(source, /d1_history_backfill_budget_exceeded/);
  assert.match(source, /created_at < \$\{cursorCreatedAt\} OR \(created_at = \$\{cursorCreatedAt\} AND id < \$\{cursorId\}\)/);
  assert.doesNotMatch(source, /\bOFFSET\b/i);
});

test("history cursor advances only after D1 data batches succeed", () => {
  const batchIndex = source.indexOf("await runBatches(db, statements);");
  const stateIndex = source.indexOf("await saveProgress(db, companyId, hasMore");
  assert.ok(batchIndex >= 0 && stateIndex > batchIndex);
});

test("history copies delivered rows, events and bounded ETA history idempotently", () => {
  assert.match(source, /status = 'Delivered'/);
  assert.match(source, /delivery_events/);
  assert.match(source, /delivery_eta_observations/);
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(delivery_id, type\) DO UPDATE SET/);
  assert.match(source, /ON CONFLICT\(delivery_id, position_at\) DO UPDATE SET/);
});

test("history state schema is explicit and never created by the runtime backfill", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS d1_history_backfill_state/);
  assert.match(schema, /cursor_created_at integer/);
  assert.match(schema, /cursor_id text/);
  assert.match(schema, /completed_at integer/);
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|PRAGMA/i);
});

test("history backfill endpoint requires cron bearer authorization", () => {
  assert.match(route, /runtimeEnv\.CRON_SECRET\?\.trim\(\)/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 401/);
  assert.match(route, /backfillD1DeliveryHistory\(\)/);
});
