import { runtimeEnv } from "trackfleet-runtime-env";
import { customerFacingEvent, type DeliveryEventType } from "./delivery-events";
import type { DeliveryRow } from "./delivery-store.types";

function recipientFrom(delivery: DeliveryRow) {
  // Automatic customer notifications must only use the contact attached to
  // this delivery. Never fall back to the demo recipient in production logic.
  const contactDigits = delivery.contact.replace(/\D/g, "");
  return contactDigits.length >= 8 ? contactDigits : "";
}

function eventText(event: DeliveryEventType, delivery: DeliveryRow, trackingUrl: string) {
  switch (event) {
    case "DEPARTED":
      return `Your delivery has departed. Track it here: ${trackingUrl}`;
    case "PROGRESS_25":
      return `Your delivery is about 25% complete. Track it here: ${trackingUrl}`;
    case "PROGRESS_50":
      return `Your delivery is about halfway to ${delivery.destination}. Track it here: ${trackingUrl}`;
    case "PROGRESS_75":
      return `Your delivery is about 75% complete. Track it here: ${trackingUrl}`;
    case "NEAR_DESTINATION":
      return `Your delivery is approaching ${delivery.destination}. Track it here: ${trackingUrl}`;
    case "DELAY_DETECTED":
      return `Your delivery is running later than planned. The tracking page has the latest estimate: ${trackingUrl}`;
    case "ARRIVED":
      return `Your delivery has arrived at ${delivery.destination}.`;
    default:
      return "";
  }
}

export async function sendAutomaticWhatsAppNotification(
  event: DeliveryEventType,
  delivery: DeliveryRow,
  trackingUrl: string,
) {
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") return { sent: false, reason: "disabled" as const };
  if (!customerFacingEvent(event)) return { sent: false, reason: "internal_event" as const };

  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const recipient = recipientFrom(delivery);
  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim() || "jaspers_market_order_confirmation_v1";
  const message = eventText(event, delivery, trackingUrl);
  if (!token || !phoneNumberId || !recipient || !message) return { sent: false, reason: "not_configured" as const };

  const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: delivery.customer },
            { type: "text", text: delivery.id },
            { type: "text", text: message },
          ],
        }],
      },
    }),
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
