import { store } from "trackfleet-delivery-store";
import { sendAutomaticWhatsAppNotification } from "./whatsapp-automation";

export async function processPendingNotifications(companyId: string, origin: string) {
  const pending = await store.listPendingNotifications(companyId);
  let sent = 0;
  let failed = 0;

  for (const item of pending) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;

    const trackingUrl = new URL(origin);
    trackingUrl.searchParams.set("tracking", item.delivery.trackingToken || item.delivery.id);

    try {
      const result = await sendAutomaticWhatsAppNotification(item.event.type, item.delivery, trackingUrl.toString());
      if (result.sent) {
        await store.markNotificationSent(item.delivery.id, item.event.type);
        sent += 1;
      } else {
        await store.releaseNotification(item.delivery.id, item.event.type);
        if (result.reason !== "disabled") failed += 1;
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

  return { pending: pending.length, sent, failed };
}
