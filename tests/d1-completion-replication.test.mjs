import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/delivery-completion.shared-postgres.ts", "utf8");

test("arrival completion mirrors only after the primary result exists", () => {
  assert.match(source, /const result = await observePrimaryArrivalCompletion\(input\);\s*await mirrorArrivalObservation\(input, result\);\s*return result;/s);
});

test("automatic completion mirrors delivered state and ARRIVED event", () => {
  assert.match(source, /if \(result\.deliveredNow\)/);
  assert.match(source, /UPDATE deliveries SET status = 'Delivered', progress = 100/);
  assert.match(source, /INSERT OR IGNORE INTO delivery_events \(delivery_id, type, progress, created_at\) VALUES \(\?, 'ARRIVED', 100, \?\)/);
});

test("arrival dwell state is mirrored and cleared consistently", () => {
  assert.match(source, /INSERT INTO delivery_arrival_state/);
  assert.match(source, /ON CONFLICT\(company_id, delivery_id\) DO UPDATE/);
  assert.match(source, /DELETE FROM delivery_arrival_state WHERE company_id = \? AND delivery_id = \?/);
  assert.match(source, /DELETE FROM delivery_events WHERE delivery_id = \? AND type = 'ARRIVED_AT_SITE'/);
});

test("manual completion mirrors only after Postgres succeeds", () => {
  assert.match(source, /const completed = await completePrimaryManually\(companyId, deliveryId\);\s*if \(completed\) await mirrorManualCompletion\(companyId, deliveryId\);\s*return completed;/s);
  assert.match(source, /'MANUAL_DELIVERED'/);
  assert.match(source, /'ARRIVED'/);
});

test("completion mirroring is best-effort", () => {
  assert.match(source, /function replicationError/);
  assert.doesNotMatch(source, /throw error/);
});
