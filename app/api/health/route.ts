import { runtimeEnv } from "trackfleet-runtime-env";
import { automationMissingRequirements } from "../../lib/automation-health";
import { parseAutomationStartAt } from "../../lib/notification-policy";
import { isSendatrackConfigured } from "../../lib/sendatrack";
import { getStorageHealth } from "../../lib/storage-health";

export async function GET() {
  const storage = await getStorageHealth();
  const sendatrackConfigured = isSendatrackConfigured();
  const tickProtected = Boolean(runtimeEnv.CRON_SECRET?.trim());
  const whatsappEnabled = runtimeEnv.WHATSAPP_AUTOMATION_ENABLED === "true";
  const whatsappProviderConfigured = Boolean(
    runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim()
    && runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim()
    && runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim(),
  );
  const whatsappActivationConfigured = Boolean(parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT));
  const missing = automationMissingRequirements({
    storage,
    sendatrackConfigured,
    tickProtected,
    whatsappEnabled,
    whatsappProviderConfigured,
    whatsappActivationConfigured,
  });

  return Response.json({
    ok: storage.connected,
    service: "trackfleet",
    sendatrackConfigured,
    storage,
    automation: {
      tickProtected,
      whatsappEnabled,
      whatsappProviderConfigured,
      whatsappActivationConfigured,
      ready: missing.length === 0,
      missing,
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
