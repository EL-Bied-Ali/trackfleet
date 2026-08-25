import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerEmail } from "./customer-contact";
import type { DeliveryEventType } from "./delivery-events";
import type { DeliveryRow } from "./delivery-store.types";
import { automaticEmailSubject } from "./email-message";
import { isAutomaticWhatsAppEvent } from "./notification-policy";
import { automaticWhatsAppMessage } from "./whatsapp-message";

// Email is the baseline notification channel available on every plan
// (unlike WhatsApp, a Pro-tier add-on -- see app/lib/subscription-store.ts's
// whatsappIncludedInPlan). isAutomaticWhatsAppEvent is channel-agnostic
// despite the name: it's really "which delivery events are customer-facing
// enough to notify automatically," the same list for either channel.
const emailRequestTimeoutMs = 10_000;

function recipientEmailFrom(delivery: DeliveryRow) {
  // Mirrors whatsapp-automation.ts's recipientsFrom: only the sender (the
  // party who registered/dropped off the parcel) gets messaged, not the
  // recipient -- keeps volume to one email per delivery event.
  return normalizeCustomerEmail(delivery.customerEmail ?? null);
}

type AutomaticEmailBuildReason = "ok" | "internal_event" | "no_email" | "not_configured";

export function buildAutomaticEmailPayload(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  trackingUrl: string,
): { payload: { to: string; subject: string; text: string } | null; reason: AutomaticEmailBuildReason } {
  if (!isAutomaticWhatsAppEvent(event)) return { payload: null, reason: "internal_event" };

  const to = recipientEmailFrom(delivery);
  if (!to) return { payload: null, reason: "no_email" };

  const from = runtimeEnv.EMAIL_FROM_ADDRESS?.trim();
  const message = automaticWhatsAppMessage(event, delivery, trackingUrl);
  if (!from || !message) return { payload: null, reason: "not_configured" };

  return {
    reason: "ok",
    payload: { to, subject: automaticEmailSubject(event, delivery), text: message },
  };
}

export async function sendAutomaticEmailNotification(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  trackingUrl: string,
) {
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") return { sent: false, reason: "disabled" as const };

  const apiKey = runtimeEnv.EMAIL_API_KEY?.trim();
  const from = runtimeEnv.EMAIL_FROM_ADDRESS?.trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" as const };

  const built = buildAutomaticEmailPayload(event, delivery, trackingUrl);
  if (!built.payload) return { sent: false, reason: built.reason };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: built.payload.to,
      subject: built.payload.subject,
      text: built.payload.text,
    }),
    signal: AbortSignal.timeout(emailRequestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:email] automatic notification failed", {
      deliveryId: delivery.id,
      event,
      status: response.status,
    });
    return { sent: false, reason: "provider_error" as const };
  }

  console.info("[trackfleet:email] automatic notification sent", { deliveryId: delivery.id, event });
  return { sent: true as const };
}
