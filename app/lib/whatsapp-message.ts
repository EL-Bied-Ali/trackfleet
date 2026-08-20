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
      return `Votre colis ${delivery.id} a bien été enregistré pour ${delivery.destination}. Consultez son suivi et l'estimation d'arrivée ici : ${trackingUrl}`;
    case "DEPARTED":
      return `Votre colis ${delivery.id} est parti vers ${delivery.destination}. L'estimation d'arrivée est mise à jour ici : ${trackingUrl}`;
    case "PROGRESS_25":
    case "PROGRESS_50":
    case "PROGRESS_75":
      return `Votre colis ${delivery.id} poursuit son trajet vers ${delivery.destination}. Suivi : ${trackingUrl}`;
    case "NEAR_DESTINATION":
      return `Votre colis ${delivery.id} approche de ${delivery.destination}. Consultez les dernières informations ici : ${trackingUrl}`;
    case "DELAY_DETECTED":
      return `Le trajet de votre colis ${delivery.id} prend plus de temps que prévu. Consultez la nouvelle estimation ici : ${trackingUrl}`;
    case "ARRIVED_AT_SITE":
    case "ARRIVED":
      return `Votre colis ${delivery.id} est arrivé à ${delivery.destination}.`;
    default:
      return "";
  }
}
