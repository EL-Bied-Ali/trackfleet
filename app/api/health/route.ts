import { getAutomationFailureCode, getAutomationHeartbeat, getRuntimeHeartbeat } from "trackfleet-automation-heartbeat";
import { runtimeEnv } from "trackfleet-runtime-env";
import {
  activeHeartbeatFailureCode,
  automationHeartbeatStatus,
  AUTOMATION_HEARTBEAT_STALE_AFTER_MS,
  retentionHeartbeatStatus,
  RETENTION_HEARTBEAT_STALE_AFTER_MS,
} from "../../lib/automation-heartbeat-health";
import { automationMissingRequirements } from "../../lib/automation-health";
import { parseUnloadGraceMinutes } from "../../lib/delivery-arrival";
import { parseAutomationStartAt } from "../../lib/notification-policy";
import { sessionEncryptionKeyConfigured } from "../../lib/session-encryption-key";
import { isSendatrackConfigured } from "../../lib/sendatrack";
import {
  insecureSendatrackTransportExplicitlyAllowed,
  sendatrackTransportIsAllowed,
  sendatrackTransportIsSecure,
} from "../../lib/sendatrack-transport";
import { getStorageHealth } from "../../lib/storage-health";
import { telemetryRetentionPolicy } from "../../lib/telemetry-retention";

// /api/health is polled far more often than any other route (uptime
// monitors, and this session's own live-verification work) and, unlike
// the automation/maintenance crons that also read storage/heartbeat
// state every ~15 minutes, has no reason to recompute it fresh on every
// single hit. Each call previously did 5 separate DB round trips (a
// multi-CTE Postgres schema-compatibility probe, a 5-subquery D1
// readiness check, and 3 more D1 heartbeat reads) -- real per-request
// CPU work that, on the account's Workers Free plan (fixed 10ms CPU
// limit, cannot be raised -- see wrangler.jsonc git history around
// 2026-09-04), was enough on its own to intermittently trip "Worker
// exceeded CPU time limit" (Cloudflare error 1102) on a plain health
// check. Cached here, not inside storage-health.ts/automation-heartbeat
// itself, so the cron-driven callers (automation tick, notification
// tick, retention, whatsapp preflight) keep reading fully fresh state --
// only this frequently-polled diagnostic endpoint trades a few seconds
// of staleness for far less per-request work.
const healthCacheTtlMs = 20_000;
let cachedBody: Record<string, unknown> | null = null;
let cachedStatus = 200;
let cachedAt = 0;

export async function GET() {
  const now = Date.now();
  if (cachedBody && now - cachedAt < healthCacheTtlMs) {
    return Response.json({ ...cachedBody, timestamp: new Date(now).toISOString() }, {
      status: cachedStatus,
      headers: {
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }

  const storage = await getStorageHealth();
  const sendatrackConfigured = isSendatrackConfigured();
  const sendatrackTransportSecure = sendatrackTransportIsSecure();
  const sendatrackInsecureOverrideEnabled = insecureSendatrackTransportExplicitlyAllowed();
  const sendatrackTransportAllowed = sendatrackTransportIsAllowed();
  const sessionEncryptionConfigured = sessionEncryptionKeyConfigured(runtimeEnv.TRACKFLEET_ENCRYPTION_KEY);
  const tickProtected = Boolean(runtimeEnv.CRON_SECRET?.trim());
  const whatsappEnabled = runtimeEnv.WHATSAPP_AUTOMATION_ENABLED === "true";
  const whatsappProviderConfigured = Boolean(
    runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim()
    && runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim()
    && runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim()
    && runtimeEnv.WHATSAPP_TEMPLATE_LANGUAGE?.trim(),
  );
  const whatsappActivationConfigured = Boolean(parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT));
  const telemetryRetention = telemetryRetentionPolicy(runtimeEnv.TRACKFLEET_TELEMETRY_RETENTION_DAYS);
  const unloadGraceMinutes = parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
  const missing = automationMissingRequirements({
    storage,
    sendatrackConfigured,
    sendatrackTransportSecure: sendatrackTransportAllowed,
    sessionEncryptionConfigured,
    tickProtected,
    whatsappEnabled,
    whatsappProviderConfigured,
    whatsappActivationConfigured,
  });

  let heartbeatAvailable = false;
  let heartbeat = automationHeartbeatStatus({ lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null });
  let lastFailureCode = null;
  try {
    heartbeat = automationHeartbeatStatus(await getAutomationHeartbeat());
    lastFailureCode = activeHeartbeatFailureCode(heartbeat, await getAutomationFailureCode());
    heartbeatAvailable = true;
  } catch (error) {
    console.error("[trackfleet:health] automation heartbeat unavailable", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    heartbeat = {
      ...heartbeat,
      staleAfterSeconds: Math.floor(AUTOMATION_HEARTBEAT_STALE_AFTER_MS / 1000),
    };
  }

  let retentionHeartbeatAvailable = false;
  let retentionHeartbeat = retentionHeartbeatStatus({ lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null });
  try {
    retentionHeartbeat = retentionHeartbeatStatus(await getRuntimeHeartbeat("telemetry_retention"));
    retentionHeartbeatAvailable = true;
  } catch (error) {
    console.error("[trackfleet:health] retention heartbeat unavailable", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    retentionHeartbeat = {
      ...retentionHeartbeat,
      staleAfterSeconds: Math.floor(RETENTION_HEARTBEAT_STALE_AFTER_MS / 1000),
    };
  }

  const body = {
    ok: storage.connected,
    service: "trackfleet",
    sendatrackConfigured,
    sendatrackTransportSecure,
    sendatrackTransportAllowed,
    sendatrackInsecureOverrideEnabled,
    sessionEncryptionConfigured,
    storage,
    telemetryRetention: {
      ...telemetryRetention,
      heartbeatAvailable: retentionHeartbeatAvailable,
      live: retentionHeartbeatAvailable ? retentionHeartbeat.fresh : null,
      heartbeat: retentionHeartbeat,
    },
    deliveryCompletion: {
      unloadGraceMinutes,
      gpsFreshnessRequiredMinutes: 30,
      maximumArrivalSpeedKmh: 5,
    },
    automation: {
      tickProtected,
      whatsappEnabled,
      whatsappProviderConfigured,
      whatsappActivationConfigured,
      ready: missing.length === 0,
      missing,
      heartbeatAvailable,
      live: heartbeatAvailable ? heartbeat.fresh : null,
      lastFailureCode,
      heartbeat,
    },
  };
  cachedBody = body;
  cachedStatus = storage.connected ? 200 : 503;
  cachedAt = now;

  return Response.json({ ...body, timestamp: new Date(now).toISOString() }, {
    status: cachedStatus,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
