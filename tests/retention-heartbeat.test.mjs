import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  RETENTION_HEARTBEAT_STALE_AFTER_MS,
  retentionHeartbeatStatus,
} from "../app/lib/automation-heartbeat-health.ts";

const routeSource = fs.readFileSync("app/api/maintenance/retention/route.ts", "utf8");
const healthSource = fs.readFileSync("app/api/health/route.ts", "utf8");
const postgresHeartbeat = fs.readFileSync("app/lib/automation-heartbeat.vercel.ts", "utf8");
const d1Heartbeat = fs.readFileSync("app/lib/automation-heartbeat.cloudflare.ts", "utf8");
const workflow = fs.readFileSync(".github/workflows/telemetry-retention.yml", "utf8");

test("daily retention freshness allows scheduling jitter but becomes stale after 36 hours", () => {
  assert.equal(RETENTION_HEARTBEAT_STALE_AFTER_MS, 36 * 60 * 60_000);
  const now = new Date("2026-08-20T12:00:00Z");
  assert.equal(retentionHeartbeatStatus({
    lastAttemptAt: new Date("2026-08-19T03:17:00Z"),
    lastSuccessAt: new Date("2026-08-19T03:17:00Z"),
    lastFailureAt: null,
  }, now).fresh, true);
  assert.equal(retentionHeartbeatStatus({
    lastAttemptAt: new Date("2026-08-18T23:00:00Z"),
    lastSuccessAt: new Date("2026-08-18T23:00:00Z"),
    lastFailureAt: null,
  }, now).fresh, false);
});

test("retention endpoint records attempt, success and every failure class", () => {
  assert.match(routeSource, /recordRuntimeAttempt\(retentionJob\)/);
  assert.match(routeSource, /recordRuntimeSuccess\(retentionJob\)/);
  assert.ok((routeSource.match(/recordRuntimeFailure\(retentionJob\)/g) ?? []).length >= 3);
  assert.match(routeSource, /const retentionJob = "telemetry_retention"/);
});

test("heartbeat adapters reuse the existing runtime state table without hot DDL", () => {
  for (const source of [postgresHeartbeat, d1Heartbeat]) {
    assert.match(source, /RuntimeHeartbeatJob = "fleet_tick" \| "telemetry_retention"/);
    assert.match(source, /automation_runtime_state/);
    assert.doesNotMatch(source, /CREATE TABLE/i);
    assert.doesNotMatch(source, /ALTER TABLE/i);
  }
});

test("public health exposes retention heartbeat separately from the fleet tick", () => {
  assert.match(healthSource, /getRuntimeHeartbeat\("telemetry_retention"\)/);
  assert.match(healthSource, /retentionHeartbeatStatus/);
  assert.match(healthSource, /heartbeatAvailable: retentionHeartbeatAvailable/);
  assert.match(healthSource, /live: retentionHeartbeatAvailable \? retentionHeartbeat\.fresh : null/);
});

test("retention remains a daily scheduled workflow", () => {
  assert.match(workflow, /cron: "17 3 \* \* \*"/);
  assert.match(workflow, /\/api\/maintenance\/retention/);
});
