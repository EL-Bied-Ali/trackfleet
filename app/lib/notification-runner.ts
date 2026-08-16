import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { isHistoricalNotification, parseAutomationStartAt } from "./notification-policy";
import { sendAutomaticWhatsAppNotification } from "./whatsapp-automation";

export async function processPendingNotifications(companyId: string, origin: string) {
  const pending = await store.listPendingNotifications(companyId);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  // While automation is disabled we keep events pending. When it is enabled,
  // WHATSAPP_AUTOMATION_START_AT defines the activation boundary so old
  // milestones are acknowledged without being sent in a burst.
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") {
    return { pending: pending.length, sent, failed, suppressed };
  }

  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);
  if (!automationStartAt) {
    console.error("[trackfleet:notifications] automation enabled without valid WHATSAPP_AUTOMATION_START_AT");
    return { pending: pending.length, sent, failed: pending.length, suppressed };
  }

  for (const item of pending) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;

    if (isHistoricalNotification(item.event.createdAt, automationStartAt)) {
      await store.markNotificationSent(item.delivery.id, item.event.type);
      suppressed += 1;
      continue;
    }

    const trackingUrl = new URL(origin);
    trackingUrl.searchParams.set("tracking", item.delivery.trackingToken || item.delivery.id);

    try {
      const result = await sendAutomaticWhatsAppNotification(item.event.type, item.delivery, trackingUrl.toString());
      if (result.sent) {
        await store.markNotificationSent(item.delivery.id, item.event.type);
        sent += 1;
      } else {
        await store.releaseNotification(item.delivery.id, item.event.type);
        failed += 1;
      }
    } catch (error) {
      await store.releaseNotification(item.delivery.id, item.event.type);
      failed += 1;
      console.error("[trackfleet:notifications] unexpected send failure", {
        deliveryId: item.delivery.id,
        event: item.event.type,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return { pending: pending.length, sent, failed, suppressed };
}
