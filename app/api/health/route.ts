import { getAutomationHeartbeat } from "trackfleet-automation-heartbeat";
import { runtimeEnv } from "trackfleet-runtime-env";
import { automationHeartbeatStatus, AUTOMATION_HEARTBEAT_STALE_AFTER_MS } from "../../lib/automation-heartbeat-health";
import { automationMissingRequirements } from "../../lib/automation-health";
import { parseAutomationStartAt } from "../../lib/notification-policy";
import { sessionEncryptionKeyConfigured } from "../../lib/session-encryption-key";
import { isSendatrackConfigured } from "../../lib/sendatrack";
import { sendatrackTransportIsSecure } from "../../lib/sendatrack-transport";
import { getStorageHealth } from "../../lib/storage-health";

export async function GET() {
  const storage = await getStorageHealth();
  const sendatrackConfigured = isSendatrackConfigured();
  const sendatrackTransportSecure = sendatrackTransportIsSecure();
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
  const missing = automationMissingRequirements({
    storage,
    sendatrackConfigured,
    sendatrackTransportSecure,
    sessionEncryptionConfigured,
    tickProtected,
    whatsappEnabled,
    whatsappProviderConfigured,
    whatsappActivationConfigured,
  });

  let heartbeatAvailable = false;
  let heartbeat = automationHeartbeatStatus({ lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null });
  try {
    heartbeat = automationHeartbeatStatus(await getAutomationHeartbeat());
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

  return Response.json({
    ok: storage.connected,
    service: "trackfleet",
    sendatrackConfigured,
    sendatrackTransportSecure,
    sessionEncryptionConfigured,
    storage,
    automation: {
      tickProtected,
      whatsappEnabled,
      whatsappProviderConfigured,
      whatsappActivationConfigured,
      ready: missing.length === 0,
      missing,
      heartbeatAvailable,
      live: heartbeatAvailable ? heartbeat.fresh : null,
      heartbeat,
    },
    timestamp: new Date().toISOString(),
  }, {
    status: storage.connected ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
