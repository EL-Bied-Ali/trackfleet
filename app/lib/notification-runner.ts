import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { isAutomaticWhatsAppEvent, isHistoricalNotification, parseAutomationStartAt, splitLatestPendingNotifications } from "./notification-policy";
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

  // Progress milestones stay available in the tracking timeline, but the MVP
  // deliberately does not push them to WhatsApp. The customer receives only
  // operationally useful messages: registration, departure, delay, approach,
  // and arrival.
  const eligible = pending.filter((item) => isAutomaticWhatsAppEvent(item.event.type));
  const ignored = pending.filter((item) => !isAutomaticWhatsAppEvent(item.event.type));
  for (const item of ignored) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;
    await store.markNotificationSent(item.delivery.id, item.event.type);
    suppressed += 1;
  }

  // If several useful customer events accumulated for the same delivery while
  // the provider/scheduler was unavailable, send only the newest useful state.
  const { actionable, superseded } = splitLatestPendingNotifications(eligible);
  for (const item of superseded) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;
    await store.markNotificationSent(item.delivery.id, item.event.type);
    suppressed += 1;
  }

  for (const item of actionable) {
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
      } else if (result.reason === "consent_missing" || result.reason === "recipient_missing" || result.reason === "internal_event") {
        // Missing consent/contact is permanent for this queued event and must
        // not become a five-minute retry loop. Only explicit opt-in at parcel
        // intake allows an automatic customer message.
        await store.markNotificationSent(item.delivery.id, item.event.type);
        suppressed += 1;
      } else {
        // Provider/configuration failures are retryable. Release the claim so a
        // later scheduler tick can try again after the problem is corrected.
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
