import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { processPendingNotifications } from "./notification-runner";

// Shared by the dispatcher/agency "Confirmer l'arrivée" button
// (manual-completion/route.ts) and the QR "Arrivée" scan checkpoint
// (scan/route.ts) -- both are the same real-world action (a human
// confirming a truck has physically reached its destination), so both
// should record it and trigger the same WhatsApp arrival notification,
// rather than one of them growing a second, subtly different path to the
// same outcome.
//
// The configurable unload-grace period (see delivery-arrival.ts) exists to
// filter out an uncertain GPS signal -- a truck merely idling near a
// destination isn't proof it has actually arrived and is being unloaded.
// A human confirming arrival, whether by clicking this button or scanning
// a QR at the destination itself, has no such uncertainty to filter: live
// feedback, "GPS inferred arrival was a bad idea... it doesn't go to the
// agencies directly" -- and the tick's own comment already treated this
// as settled ("the explicit confirmation is the arrival evidence"), it
// just still made the customer wait out the same buffer anyway. Passing 0
// here means observeArrivalCompletion completes the delivery on this very
// call, not on some later tick.
const noGracePeriod = 0;

export async function confirmArrivalManually(companyId: string, deliveryId: string, progress: number, origin: string): Promise<void> {
  const now = new Date();
  await observeArrivalCompletion({
    companyId,
    deliveryId,
    insideArrivalZone: true,
    observationAt: now,
    unloadGraceMinutes: noGracePeriod,
  });
  await store.recordEvent(deliveryId, "MANUAL_ARRIVAL_CONFIRMED", Math.min(99, progress));
  await store.recordEvent(deliveryId, "ARRIVED_AT_SITE", Math.min(99, progress));
  await processPendingNotifications(companyId, origin);
}
