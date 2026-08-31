import { getCompanyAutomationSettings } from "trackfleet-auth-session-store";
import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { clampUnloadGraceMinutes, parseUnloadGraceMinutes } from "./delivery-arrival";
import { processPendingNotifications } from "./notification-runner";

// Shared by the dispatcher/agency "Confirmer l'arrivée" button
// (manual-completion/route.ts) and the QR "Arrivée" scan checkpoint
// (scan/route.ts) -- both are the same real-world action (a human
// confirming a truck has physically reached its destination), so both
// should record it, start the same unload-grace completion timer, and
// trigger the same WhatsApp arrival notification, rather than one of them
// growing a second, subtly different path to the same outcome.
export async function confirmArrivalManually(companyId: string, deliveryId: string, progress: number, origin: string): Promise<{ unloadGraceMinutes: number }> {
  const now = new Date();
  const automationSettings = await getCompanyAutomationSettings(companyId);
  const unloadGraceMinutes = typeof automationSettings?.unloadGraceMinutes === "number"
    ? clampUnloadGraceMinutes(automationSettings.unloadGraceMinutes)
    : parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
  await observeArrivalCompletion({
    companyId,
    deliveryId,
    insideArrivalZone: true,
    observationAt: now,
    unloadGraceMinutes,
  });
  await store.recordEvent(deliveryId, "MANUAL_ARRIVAL_CONFIRMED", Math.min(99, progress));
  await store.recordEvent(deliveryId, "ARRIVED_AT_SITE", Math.min(99, progress));
  await processPendingNotifications(companyId, origin);
  return { unloadGraceMinutes };
}
