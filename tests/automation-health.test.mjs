import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { automationMissingRequirements } from "../app/lib/automation-health.ts";
import { activeHeartbeatFailureCode, automationHeartbeatStatus, AUTOMATION_HEARTBEAT_STALE_AFTER_MS } from "../app/lib/automation-heartbeat-health.ts";
import { decodeSessionEncryptionKey, sessionEncryptionKeyConfigured } from "../app/lib/session-encryption-key.ts";

await import("./telemetry-retention.test.mjs");

const [healthRoute, tickRoute, sendatrackTransport, vercelHeartbeat, cloudflareHeartbeat] = await Promise.all([
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation/tick/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/sendatrack-transport.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/automation-heartbeat.vercel.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/automation-heartbeat.cloudflare.ts", import.meta.url), "utf8"),
]);
const persistentStorage = { mode: "postgres", persistent: true, connected: true, error: null };

test("health explains why production automation is not ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: { mode: "memory", persistent: false, connected: true, error: null },
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: true,
    tickProtected: false,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["persistent_storage", "cron_secret"]);
});

test("dedicated session encryption key is required for production readiness", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: false,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["session_encryption_key"]);
});

test("insecure SENDATRACK transport blocks a production-ready status", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: false,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["sendatrack_https"]);
});

test("SENDATRACK transport readiness requires HTTPS on the expected provider host", () => {
  assert.match(sendatrackTransport, /target\.protocol === "https:"/);
  assert.match(sendatrackTransport, /target\.hostname === EXPECTED_SENDATRACK_HOST/);
  assert.match(sendatrackTransport, /EXPECTED_SENDATRACK_HOST = "backend2\.sendatrack\.com"/);
});

test("session encryption readiness accepts only a 32-byte Base64 key", () => {
  const valid = Buffer.alloc(32, 7).toString("base64");
  const validUrl = valid.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  assert.equal(sessionEncryptionKeyConfigured(valid), true);
  assert.equal(sessionEncryptionKeyConfigured(validUrl), true);
  assert.equal(decodeSessionEncryptionKey(valid)?.byteLength, 32);
  assert.equal(sessionEncryptionKeyConfigured(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(sessionEncryptionKeyConfigured(Buffer.alloc(33, 7).toString("base64")), false);
  assert.equal(sessionEncryptionKeyConfigured("not base64 !!!"), false);
  assert.equal(sessionEncryptionKeyConfigured(""), false);
  assert.equal(sessionEncryptionKeyConfigured(undefined), false);
});

test("disabled WhatsApp does not block GPS automation readiness when core security is ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), []);
});

test("enabled WhatsApp requires provider and activation boundary", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: true,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["whatsapp_provider", "whatsapp_activation_start"]);
});

test("scheduler heartbeat becomes stale after three missed five-minute ticks", () => {
  assert.equal(AUTOMATION_HEARTBEAT_STALE_AFTER_MS, 15 * 60_000);
  const now = new Date("2026-08-19T00:20:00.000Z");
  const fresh = automationHeartbeatStatus({
    lastAttemptAt: new Date("2026-08-19T00:15:00.000Z"),
    lastSuccessAt: new Date("2026-08-19T00:10:00.000Z"),
    lastFailureAt: null,
  }, now);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.successAgeSeconds, 600);

  const stale = automationHeartbeatStatus({
    lastAttemptAt: new Date("2026-08-19T00:04:00.000Z"),
    lastSuccessAt: new Date("2026-08-19T00:04:59.000Z"),
    lastFailureAt: null,
  }, now);
  assert.equal(stale.fresh, false);
});

test("health clears an old provider failure after a newer successful tick", () => {
  assert.equal(activeHeartbeatFailureCode({
    lastSuccessAt: "2026-08-19T00:10:00.000Z",
    lastFailureAt: "2026-08-19T00:05:00.000Z",
  }, "sendatrack_authentication_failed"), null);
  assert.equal(activeHeartbeatFailureCode({
    lastSuccessAt: "2026-08-19T00:05:00.000Z",
    lastFailureAt: "2026-08-19T00:10:00.000Z",
  }, "sendatrack_authentication_failed"), "sendatrack_authentication_failed");
});

test("automation tick records best-effort attempt, success and failure heartbeats", () => {
  assert.match(tickRoute, /recordAutomationAttempt/);
  assert.match(tickRoute, /recordAutomationSuccess/);
  assert.match(tickRoute, /recordAutomationFailure/);
  assert.match(tickRoute, /bestEffortHeartbeat/);
});

test("heartbeat persistence exists on both Neon and D1 without storing error details", () => {
  for (const source of [vercelHeartbeat, cloudflareHeartbeat]) {
    assert.match(source, /automation_runtime_state/);
    assert.match(source, /last_attempt_at/);
    assert.match(source, /last_success_at/);
    assert.match(source, /last_failure_at/);
    assert.doesNotMatch(source, /error_message|error_detail|stack/);
  }
});

// Root-caused live 2026-09-04: /api/health is polled far more often than
// any other route, and unlike the automation/maintenance crons that also
// read storage/heartbeat state, previously recomputed it -- 5 separate DB
// round trips -- on every single hit. On the account's Workers Free plan
// (fixed 10ms CPU limit, not configurable -- see wrangler.jsonc git
// history), that alone was enough to intermittently trip Cloudflare error
// 1102 ("Worker exceeded CPU time limit") on a plain health check.
test("the health route caches its expensive storage/heartbeat computation instead of recomputing it on every poll", () => {
  assert.match(healthRoute, /const healthCacheTtlMs = \d+_?\d*;/);
  assert.match(healthRoute, /let cachedBody: Record<string, unknown> \| null = null;/);
  // The cache check must come first, before any of the DB-touching calls
  // (getStorageHealth, getAutomationHeartbeat, getRuntimeHeartbeat) --
  // otherwise a cache hit still pays the full cost it's meant to avoid.
  const cacheCheckIndex = healthRoute.indexOf("if (cachedBody && now - cachedAt < healthCacheTtlMs)");
  const storageCallIndex = healthRoute.indexOf("await getStorageHealth()");
  assert.ok(cacheCheckIndex >= 0 && storageCallIndex > cacheCheckIndex);
});

test("a health cache hit still returns a freshly generated timestamp, not a stale cached one", () => {
  // The cache-hit branch must build its own timestamp from `now`, not
  // spread a cached timestamp field -- otherwise every response within the
  // TTL window would report the exact same instant.
  const cacheHitBranch = healthRoute.slice(
    healthRoute.indexOf("if (cachedBody && now - cachedAt < healthCacheTtlMs)"),
    healthRoute.indexOf("const storage = await getStorageHealth();"),
  );
  assert.match(cacheHitBranch, /timestamp: new Date\(now\)\.toISOString\(\)/);
  assert.doesNotMatch(cacheHitBranch, /\.\.\.cachedBody,[\s\S]*timestamp,/);
});

test("only this frequently-polled diagnostic route caches storage health -- the cron-driven callers (automation tick, notification tick, retention, whatsapp preflight) still read it fresh every call", () => {
  assert.doesNotMatch(tickRoute, /cachedBody|healthCacheTtlMs/);
});

test("health provider readiness includes explicit security, Meta, scheduler and retention diagnostics", () => {
  assert.match(healthRoute, /sessionEncryptionKeyConfigured/);
  assert.match(healthRoute, /TRACKFLEET_ENCRYPTION_KEY/);
  assert.match(healthRoute, /sendatrackTransportIsSecure/);
  assert.match(healthRoute, /sendatrackTransportSecure/);
  assert.match(healthRoute, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(healthRoute, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_LANGUAGE/);
  assert.match(healthRoute, /heartbeatAvailable/);
  assert.match(healthRoute, /live: heartbeatAvailable \? heartbeat\.fresh : null/);
  assert.match(healthRoute, /activeHeartbeatFailureCode/);
  assert.match(healthRoute, /telemetryRetentionPolicy/);
  assert.match(healthRoute, /telemetryRetention,/);
});
