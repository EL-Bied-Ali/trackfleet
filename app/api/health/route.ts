import { runtimeEnv } from "trackfleet-runtime-env";
import { parseAutomationStartAt } from "../../lib/notification-policy";
import { isSendatrackConfigured } from "../../lib/sendatrack";
import { getStorageHealth } from "../../lib/storage-health";

export async function GET() {
  const storage = await getStorageHealth();
  const sendatrackConfigured = isSendatrackConfigured();
  const tickProtected = Boolean(runtimeEnv.CRON_SECRET?.trim());
  const whatsappEnabled = runtimeEnv.WHATSAPP_AUTOMATION_ENABLED === "true";
  const whatsappActivationConfigured = Boolean(parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT));
  const automationReady = storage.persistent
    && storage.connected
    && sendatrackConfigured
    && tickProtected
    && (!whatsappEnabled || whatsappActivationConfigured);

  return Response.json({
    ok: storage.connected,
    service: "trackfleet",
    sendatrackConfigured,
    storage,
    automation: {
      tickProtected,
      whatsappEnabled,
      whatsappActivationConfigured,
      ready: automationReady,
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
