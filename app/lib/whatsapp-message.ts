import type { DeliveryEventType } from "./delivery-events";

export type WhatsAppMessageDelivery = {
  id: string;
  destination: string;
  priceAmount?: number | null;
  priceCurrency?: string | null;
};

export function automaticWhatsAppMessage(
  event: DeliveryEventType,
  delivery: WhatsAppMessageDelivery,
  trackingUrl: string,
) {
  switch (event) {
    case "REGISTERED":
      return `Enregistré pour ${delivery.destination}. Suivi et estimation d'arrivée : ${trackingUrl}`;
    case "DEPARTED":
      return `Parti vers ${delivery.destination}. Estimation d'arrivée mise à jour : ${trackingUrl}`;
    case "PROGRESS_25":
    case "PROGRESS_50":
    case "PROGRESS_75":
      return `En route vers ${delivery.destination}. Suivi : ${trackingUrl}`;
    case "NEAR_DESTINATION":
      return `Proche de ${delivery.destination}. Dernières informations : ${trackingUrl}`;
    case "DELAY_DETECTED":
      return `Le trajet prend plus de temps que prévu. Nouvelle estimation : ${trackingUrl}`;
    case "ARRIVED_AT_SITE":
    case "ARRIVED":
      // A priced parcel's declared weight/manual price is already shown on
      // the customer's own tracking page (see public-delivery-view.ts) --
      // pointing back there instead of restating the amount here keeps this
      // template message a plain status update rather than something that
      // reads like a payment demand, and avoids drifting out of sync with
      // whatever the tracking page actually displays.
      return delivery.priceAmount != null && delivery.priceCurrency
        ? `Arrivé à ${delivery.destination}. Facture disponible : ${delivery.priceAmount.toFixed(2)} ${delivery.priceCurrency}. Détails : ${trackingUrl}`
        : `Arrivé à ${delivery.destination}.`;
    default:
      return "";
  }
}

// WhatsApp-only variant: no URL embedded in the text. Meta's Cloud API
// rejects template body parameters that contain a raw URL (an anti-phishing
// restriction -- confirmed live: every automatic send was failing with a
// 400 until the link moved out of the body). The tracking link is instead
// sent as the template's dynamic URL button parameter (see
// buildAutomaticWhatsAppPayload in whatsapp-automation.ts). Email has no
// such restriction, so automaticWhatsAppMessage above (URL inline) is still
// what email-automation.ts uses for its own body text.
export function automaticWhatsAppBodyMessage(
  event: DeliveryEventType,
  delivery: WhatsAppMessageDelivery,
) {
  switch (event) {
    case "REGISTERED":
      return `Enregistré pour ${delivery.destination}. Suivi ci-dessous.`;
    case "DEPARTED":
      return `Parti vers ${delivery.destination}. Suivi ci-dessous.`;
    case "PROGRESS_25":
    case "PROGRESS_50":
    case "PROGRESS_75":
      return `En route vers ${delivery.destination}. Suivi ci-dessous.`;
    case "NEAR_DESTINATION":
      return `Proche de ${delivery.destination}. Suivi ci-dessous.`;
    case "DELAY_DETECTED":
      return `Le trajet prend plus de temps que prévu. Nouvelle estimation ci-dessous.`;
    case "ARRIVED_AT_SITE":
    case "ARRIVED":
      return delivery.priceAmount != null && delivery.priceCurrency
        ? `Arrivé à ${delivery.destination}. Facture disponible : ${delivery.priceAmount.toFixed(2)} ${delivery.priceCurrency}. Détails ci-dessous.`
        : `Arrivé à ${delivery.destination}.`;
    default:
      return "";
  }
}
