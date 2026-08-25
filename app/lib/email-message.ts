import type { DeliveryEventType } from "./delivery-events";

export type EmailMessageDelivery = { destination: string };

// Body reuses automaticWhatsAppMessage (see whatsapp-message.ts) -- same
// underlying status update, just delivered over a different channel, so
// there's no reason to maintain two separate copies of the same text.
export function automaticEmailSubject(event: DeliveryEventType, delivery: EmailMessageDelivery) {
  switch (event) {
    case "REGISTERED":
      return `Colis enregistré – ${delivery.destination}`;
    case "DEPARTED":
      return `Camion parti – ${delivery.destination}`;
    case "DELAY_DETECTED":
      return `Retard détecté – ${delivery.destination}`;
    case "NEAR_DESTINATION":
      return `Livraison imminente – ${delivery.destination}`;
    case "ARRIVED_AT_SITE":
    case "ARRIVED":
      return `Livraison arrivée – ${delivery.destination}`;
    default:
      return `Mise à jour de livraison – ${delivery.destination}`;
  }
}
