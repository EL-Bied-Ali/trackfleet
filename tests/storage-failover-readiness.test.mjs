import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const health = fs.readFileSync("app/lib/storage-health.ts", "utf8");
const readiness = fs.readFileSync("app/lib/d1-standby-readiness.ts", "utf8");
const vite = fs.readFileSync("vite.config.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

test("Postgres health reports D1 standby separately from the active backend", () => {
  assert.match(health, /failover: StorageFailoverHealth/);
  assert.match(health, /candidate: "cloudflare-d1"/);
  assert.match(health, /ready: readiness\.ready/);
  assert.match(health, /reason: readiness\.reason === "ready" \? "replication_ready" : readiness\.reason/);
  assert.match(health, /const automatic = d1ReadFailoverConfigured\(\)/);
  assert.match(health, /automatic,/);
});

// Reported live: discussing what happens if Neon's monthly compute/transfer
// quota runs out found telemetryFresh (retention/growth analytics, not live
// delivery data) was ALSO gating readiness -- a stale telemetry cron alone,
// unrelated to whether D1 can serve a dispatcher's dashboard, could leave
// the whole app with no working read failover during a real Postgres
// outage. Only the operational stream (deliveries/trips/events/ETA/fleet
// positions) gates `ready` now; telemetryFresh is still computed/exposed
// for observability, just no longer part of the gate itself -- see
// tests/d1-standby-readiness-behavior.test.mjs for the behavioral proof.
test("D1 readiness requires fresh operational reconciliation plus complete history; telemetry freshness is tracked but does not gate readiness", () => {
  assert.match(readiness, /D1_STANDBY_MAX_SYNC_AGE_MS = 30 \* 60_000/);
  assert.match(readiness, /id = 'd1_reconciliation'/);
  assert.match(readiness, /id = 'd1_telemetry_reconciliation'/);
  assert.match(readiness, /d1_history_backfill_state/);
  assert.match(readiness, /operationalFresh/);
  assert.match(readiness, /telemetryFresh/);
  assert.match(readiness, /history_backfill_incomplete/);
  assert.match(readiness, /ready: reason === "ready"/);
  assert.match(readiness, /if \(!operationalLastSuccessAt\) reason = "replication_not_started";\s*\n\s*else if \(!operationalFresh\) reason = "replication_stale";\s*\n\s*else if \(!historyComplete\) reason = "history_backfill_incomplete";/);
  assert.doesNotMatch(readiness, /if \(!operationalLastSuccessAt \|\| !telemetryLastSuccessAt\)/);
  assert.doesNotMatch(readiness, /!operationalFresh \|\| !telemetryFresh/);
});

test("Cloudflare Postgres can compile read failover wrappers without enabling them by default", () => {
  assert.match(vite, /const useCloudflarePostgresFailover = !isVercel && process\.env\.TRACKFLEET_STORAGE === "postgres"/);
  assert.match(vite, /delivery-store\.cloudflare-postgres-failover\.ts/);
  assert.match(vite, /delivery-store\.shared-postgres\.ts/);
  assert.match(envExample, /TRACKFLEET_D1_READ_FAILOVER=false/);
});

test("readiness alone never enables automatic D1 failover", () => {
  assert.match(health, /d1ReadFailoverConfigured/);
  assert.doesNotMatch(health, /automatic:\s*readiness\.ready/);
  assert.doesNotMatch(health, /automatic:\s*true/);
});
