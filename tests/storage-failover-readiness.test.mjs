import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const health = fs.readFileSync("app/lib/storage-health.ts", "utf8");
const readiness = fs.readFileSync("app/lib/d1-standby-readiness.ts", "utf8");
const vite = fs.readFileSync("vite.config.ts", "utf8");

test("Postgres health reports D1 standby separately from the active backend", () => {
  assert.match(health, /failover: StorageFailoverHealth/);
  assert.match(health, /candidate: "cloudflare-d1"/);
  assert.match(health, /ready: readiness\.ready/);
  assert.match(health, /reason: readiness\.reason === "ready" \? "replication_ready" : readiness\.reason/);
  assert.match(health, /automatic: false/);
});

test("D1 readiness requires fresh operational and telemetry reconciliation plus complete history", () => {
  assert.match(readiness, /D1_STANDBY_MAX_SYNC_AGE_MS = 30 \* 60_000/);
  assert.match(readiness, /id = 'd1_reconciliation'/);
  assert.match(readiness, /id = 'd1_telemetry_reconciliation'/);
  assert.match(readiness, /d1_history_backfill_state/);
  assert.match(readiness, /operationalFresh/);
  assert.match(readiness, /telemetryFresh/);
  assert.match(readiness, /history_backfill_incomplete/);
  assert.match(readiness, /ready: reason === "ready"/);
});

test("current Cloudflare storage selection remains build-time until automatic failover is enabled separately", () => {
  assert.match(vite, /process\.env\.TRACKFLEET_STORAGE === "postgres"/);
  assert.match(vite, /useSharedPostgres \? "\.\/app\/lib\/delivery-store\.shared-postgres\.ts" : "\.\/app\/lib\/delivery-store\.cloudflare\.ts"/);
});

test("health never claims automatic D1 failover merely because readiness is green", () => {
  assert.doesNotMatch(health, /automatic:\s*true/);
});
