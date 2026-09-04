import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerPhone } from "./customer-contact";
import type { DeliveryEventType } from "./delivery-events";
import type { DeliveryRow } from "./delivery-store.types";
import { isAutomaticWhatsAppEvent } from "./notification-policy";
import { whatsappTemplateLanguage } from "./whatsapp-template";
import { automaticWhatsAppBodyMessage } from "./whatsapp-message";

export { automaticWhatsAppMessage } from "./whatsapp-message";

const metaRequestTimeoutMs = 10_000;

// Meta's Cloud API rejects template body parameters containing newlines,
// tabs, or more than 4 consecutive spaces. customer/destination are only
// length-validated at intake (app/api/deliveries/route.ts), not character-
// filtered, so a name containing one of these would make every automatic
// send attempt fail identically -- and since that failure is classified as
// "provider_error" (deliberately retryable, so a real transient Meta outage
// still gets picked up later), it would retry forever on every tick with no
// operator-visible signal that THIS delivery can never succeed. Sanitizing
// right here, at the point text enters a template parameter, fixes that
// without touching the stored data or its display anywhere else in the app.
function sanitizeTemplateParam(text: string) {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

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
    components: [
      {
        type: "body";
        parameters: [
          { type: "text"; text: string },
          { type: "text"; text: string },
          { type: "text"; text: string },
        ];
      },
      {
        type: "button";
        sub_type: "url";
        index: "0";
        parameters: [{ type: "text"; text: string }];
      },
    ];
  };
};

type AutomaticPayloadBuildReason = "ok" | "internal_event" | "consent_missing" | "recipient_missing" | "not_configured";

// The template's tracking link is a dynamic URL button, not text inside the
// body -- Meta's Cloud API rejects a raw URL inside a body parameter
// (anti-phishing restriction; confirmed live, see whatsapp-message.ts's
// automaticWhatsAppBodyMessage). The button's base URL
// (https://trackfleet.chronoplan.workers.dev/?tracking={{1}}) is configured
// once in the approved Meta template -- only the {{1}} suffix (the tracking
// token itself, not the full URL) travels in this request.
export function buildAutomaticWhatsAppPayload(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  parcelCount = 1,
): { payload: AutomaticWhatsAppPayload | null; reason: AutomaticPayloadBuildReason } {
  if (!isAutomaticWhatsAppEvent(event)) return { payload: null, reason: "internal_event" };
  if (delivery.whatsappOptIn !== true) return { payload: null, reason: "consent_missing" };

  const recipient = recipientsFrom(delivery)[0];
  if (!recipient) return { payload: null, reason: "recipient_missing" };
  if (!delivery.trackingToken) return { payload: null, reason: "recipient_missing" };

  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim();
  const templateLanguage = runtimeEnv.WHATSAPP_TEMPLATE_LANGUAGE?.trim();
  const message = automaticWhatsAppBodyMessage(event, delivery, parcelCount);
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
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: sanitizeTemplateParam(recipient.name) },
              { type: "text", text: sanitizeTemplateParam(delivery.id) },
              { type: "text", text: sanitizeTemplateParam(message) },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: delivery.trackingToken }],
          },
        ],
      },
    },
  };
}

export async function sendAutomaticWhatsAppNotification(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  parcelCount = 1,
) {
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") return { sent: false, reason: "disabled" as const };

  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return { sent: false, reason: "not_configured" as const };

  const built = buildAutomaticWhatsAppPayload(event, delivery, parcelCount);
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
        components: [
          {
            ...built.payload!.template.components[0],
            parameters: [
              { type: "text" as const, text: sanitizeTemplateParam(recipient.name) },
              ...built.payload!.template.components[0].parameters.slice(1),
            ],
          },
          built.payload!.template.components[1],
        ],
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
