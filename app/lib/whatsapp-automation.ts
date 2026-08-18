import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerPhone } from "./customer-contact";
import type { DeliveryEventType } from "./delivery-events";
import type { DeliveryRow } from "./delivery-store.types";
import { isAutomaticWhatsAppEvent } from "./notification-policy";
import { whatsappTemplateLanguage } from "./whatsapp-template";

const metaRequestTimeoutMs = 10_000;

function recipientFrom(delivery: DeliveryRow) {
  // Automatic customer notifications must only use the contact attached to
  // this delivery. Never fall back to the demo recipient in production logic.
  return normalizeCustomerPhone(delivery.contact) ?? "";
}

export function automaticWhatsAppMessage(event: DeliveryEventType, delivery: DeliveryRow, trackingUrl: string) {
  switch (event) {
    case "REGISTERED":
      return `Votre colis ${delivery.id} a bien été enregistré pour ${delivery.destination}. Consultez son suivi et l'estimation d'arrivée ici : ${trackingUrl}`;
    case "DEPARTED":
      return `Votre colis ${delivery.id} est parti vers ${delivery.destination}. L'estimation d'arrivée est mise à jour ici : ${trackingUrl}`;
    case "PROGRESS_25":
      return `Votre colis ${delivery.id} poursuit son trajet vers ${delivery.destination}. Suivi : ${trackingUrl}`;
    case "PROGRESS_50":
      return `Votre colis ${delivery.id} poursuit son trajet vers ${delivery.destination}. Suivi : ${trackingUrl}`;
    case "PROGRESS_75":
      return `Votre colis ${delivery.id} poursuit son trajet vers ${delivery.destination}. Suivi : ${trackingUrl}`;
    case "NEAR_DESTINATION":
      return `Votre colis ${delivery.id} approche de ${delivery.destination}. Consultez les dernières informations ici : ${trackingUrl}`;
    case "DELAY_DETECTED":
      return `Le trajet de votre colis ${delivery.id} prend plus de temps que prévu. Consultez la nouvelle estimation ici : ${trackingUrl}`;
    case "ARRIVED":
      return `Votre colis ${delivery.id} est arrivé à ${delivery.destination}.`;
    default:
      return "";
  }
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

  const recipient = recipientFrom(delivery);
  if (!recipient) return { payload: null, reason: "recipient_missing" };

  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim();
  const templateLanguage = runtimeEnv.WHATSAPP_TEMPLATE_LANGUAGE?.trim();
  const message = automaticWhatsAppMessage(event, delivery, trackingUrl);
  if (!templateName || !templateLanguage || !message) return { payload: null, reason: "not_configured" };

  return {
    reason: "ok",
    payload: {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: whatsappTemplateLanguage() },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: delivery.customer },
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

  const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(built.payload),
    signal: AbortSignal.timeout(metaRequestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:whatsapp] automatic notification failed", {
      deliveryId: delivery.id,
      event,
      status: response.status,
    });
    return { sent: false, reason: "provider_error" as const };
  }

  console.info("[trackfleet:whatsapp] automatic notification sent", {
    deliveryId: delivery.id,
    event,
  });
  return { sent: true as const };
}
