import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  MAX_TELEMETRY_RETENTION_DAYS,
  MIN_TELEMETRY_RETENTION_DAYS,
  telemetryRetentionCutoff,
  telemetryRetentionPolicy,
} from "../app/lib/telemetry-retention.ts";

const vercelSource = fs.readFileSync("app/lib/telemetry-retention.vercel.ts", "utf8");
const cloudflareSource = fs.readFileSync("app/lib/telemetry-retention.cloudflare.ts", "utf8");
const automationSource = fs.readFileSync("app/lib/server-automation.ts", "utf8");
const healthSource = fs.readFileSync("app/api/health/route.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

test("telemetry retention is disabled unless explicitly configured", () => {
  assert.deepEqual(telemetryRetentionPolicy(undefined), { configured: false, valid: true, days: null });
  assert.deepEqual(telemetryRetentionPolicy(""), { configured: false, valid: true, days: null });
});

test("telemetry retention accepts only bounded whole-day policies", () => {
  assert.equal(MIN_TELEMETRY_RETENTION_DAYS, 7);
  assert.equal(MAX_TELEMETRY_RETENTION_DAYS, 3650);
  assert.deepEqual(telemetryRetentionPolicy("7"), { configured: true, valid: true, days: 7 });
  assert.deepEqual(telemetryRetentionPolicy("180"), { configured: true, valid: true, days: 180 });
  assert.deepEqual(telemetryRetentionPolicy("3650"), { configured: true, valid: true, days: 3650 });
  for (const invalid of ["1", "6", "3651", "30.5", "abc", "-30"]) {
    assert.deepEqual(telemetryRetentionPolicy(invalid), { configured: true, valid: false, days: null });
  }
});

test("retention cutoff uses full UTC elapsed days", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  assert.equal(telemetryRetentionCutoff(30, now).toISOString(), "2026-07-20T12:00:00.000Z");
});

test("Postgres and D1 retention is tenant-scoped and throttled to once per 24 hours", () => {
  for (const source of [vercelSource, cloudflareSource]) {
    assert.match(source, /24 \* 60 \* 60 \* 1000/);
    assert.match(source, /company_id/);
    assert.match(source, /telemetry_retention_state/);
    assert.match(source, /fleet_position_observations/);
    assert.match(source, /trip_position_observations/);
    assert.match(source, /delivery_eta_observations/);
    assert.match(source, /deliveries WHERE company_id/);
    assert.doesNotMatch(source, /DELETE FROM deliveries\b/);
    assert.doesNotMatch(source, /DELETE FROM delivery_events\b/);
    assert.doesNotMatch(source, /DELETE FROM delivery_notifications\b/);
    assert.doesNotMatch(source, /DELETE FROM trips\b/);
  }
});

test("automation runs configured retention best-effort without making tracking depend on maintenance", () => {
  assert.match(automationSource, /telemetryRetentionPolicy/);
  assert.match(automationSource, /retention\.valid && retention\.days !== null/);
  assert.match(automationSource, /pruneTelemetry\(companyId, retention\.days\)/);
  assert.match(automationSource, /telemetry retention maintenance failed/);
  assert.match(automationSource, /telemetryPruned/);
});

test("health and environment example expose retention without enabling deletion by default", () => {
  assert.match(healthSource, /telemetryRetentionPolicy/);
  assert.match(healthSource, /telemetryRetention,/);
  assert.match(envExample, /TRACKFLEET_TELEMETRY_RETENTION_DAYS=/);
  assert.match(envExample, /Leave blank to disable automatic deletion/);
});
