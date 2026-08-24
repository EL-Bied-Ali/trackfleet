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
