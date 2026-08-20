import type { DeliveryEventType } from "./delivery-events";

export type WhatsAppMessageDelivery = {
  id: string;
  destination: string;
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
      return `Arrivé à ${delivery.destination}.`;
    default:
      return "";
  }
}
