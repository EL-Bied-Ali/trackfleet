import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerPhone } from "./customer-contact";
import type { DeliveryEventType } from "./delivery-events";
import type { DeliveryRow } from "./delivery-store.types";
import { isAutomaticWhatsAppEvent } from "./notification-policy";
import { whatsappTemplateLanguage } from "./whatsapp-template";
import { automaticWhatsAppMessage } from "./whatsapp-message";

export { automaticWhatsAppMessage } from "./whatsapp-message";

const metaRequestTimeoutMs = 10_000;

function recipientsFrom(delivery: DeliveryRow) {
  // Only the sender (the party who registered/dropped off the parcel) gets
  // messaged -- the recipient's own opt-in is still recorded (and still
  // shown in the dispatcher UI) but deliberately not used to send, to keep
  // WhatsApp volume to one message per delivery event instead of doubling
  // it whenever both parties are opted in.
  if (delivery.whatsappOptIn !== true) return [];
  const phone = normalizeCustomerPhone(delivery.contact) ?? "";
  if (!phone) return [];
  return [{ name: delivery.customer, phone }];
}

export type AutomaticWhatsAppPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: [{
      type: "body";
      parameters: [
        { type: "text"; text: string },
        { type: "text"; text: string },
        { type: "text"; text: string },
      ];
    }];
  };
};

type AutomaticPayloadBuildReason = "ok" | "internal_event" | "consent_missing" | "recipient_missing" | "not_configured";

export function buildAutomaticWhatsAppPayload(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  trackingUrl: string,
): { payload: AutomaticWhatsAppPayload | null; reason: AutomaticPayloadBuildReason } {
  if (!isAutomaticWhatsAppEvent(event)) return { payload: null, reason: "internal_event" };
  if (delivery.whatsappOptIn !== true) return { payload: null, reason: "consent_missing" };

  const recipient = recipientsFrom(delivery)[0];
  if (!recipient) return { payload: null, reason: "recipient_missing" };

  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim();
  const templateLanguage = runtimeEnv.WHATSAPP_TEMPLATE_LANGUAGE?.trim();
  const message = automaticWhatsAppMessage(event, delivery, trackingUrl);
  if (!templateName || !templateLanguage || !message) return { payload: null, reason: "not_configured" };

  return {
    reason: "ok",
    payload: {
      messaging_product: "whatsapp",
      to: recipient.phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: whatsappTemplateLanguage() },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: recipient.name },
            { type: "text", text: delivery.id },
            { type: "text", text: message },
          ],
        }],
      },
    },
  };
}

export async function sendAutomaticWhatsAppNotification(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  trackingUrl: string,
) {
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") return { sent: false, reason: "disabled" as const };

  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return { sent: false, reason: "not_configured" as const };

  const built = buildAutomaticWhatsAppPayload(event, delivery, trackingUrl);
  if (!built.payload) return { sent: false, reason: built.reason };
  const recipients = recipientsFrom(delivery);
  const responses = await Promise.all(recipients.map((recipient) => fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      ...built.payload,
      to: recipient.phone,
      template: {
        ...built.payload!.template,
        components: [{
          ...built.payload!.template.components[0],
          parameters: [
            { type: "text" as const, text: recipient.name },
            ...built.payload!.template.components[0].parameters.slice(1),
          ],
        }],
      },
    }),
    signal: AbortSignal.timeout(metaRequestTimeoutMs),
  })));

  if (responses.some((response) => !response.ok)) {
    console.error("[trackfleet:whatsapp] automatic notification failed", {
      deliveryId: delivery.id,
      event,
      statuses: responses.map((response) => response.status),
    });
    return { sent: false, reason: "provider_error" as const };
  }

  console.info("[trackfleet:whatsapp] automatic notification sent", {
    deliveryId: delivery.id,
    event,
    recipients: recipients.length,
  });
  return { sent: true as const };
}
