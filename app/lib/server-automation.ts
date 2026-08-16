import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { getSendatrackSnapshot } from "./sendatrack";
import { sendAutomaticWhatsAppNotification } from "./whatsapp-automation";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  notificationsSent: number;
};

export async function runFleetAutomation(origin: string): Promise<AutomationRunResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");

  const snapshot = await getSendatrackSnapshot();
  if (!snapshot.connected) {
    return {
      connected: false,
      vehicles: snapshot.vehicles.length,
      transitions: 0,
      newEvents: 0,
      notificationsSent: 0,
    };
  }

  const companyId = await companyIdForAccount(accountID);
  const transitions = await store.applySendatrackSnapshot(snapshot, companyId);
  let newEvents = 0;
  let notificationsSent = 0;

  for (const transition of transitions) {
    for (const type of transition.events) {
      const isNew = await store.recordEvent(transition.delivery.id, type, transition.delivery.progress);
      if (!isNew) continue;
      newEvents += 1;

      const trackingUrl = new URL(origin);
      trackingUrl.searchParams.set("tracking", transition.delivery.trackingToken || transition.delivery.id);
      const notification = await sendAutomaticWhatsAppNotification(type, transition.delivery, trackingUrl.toString());
      if (notification.sent) notificationsSent += 1;
    }
  }

  console.info("[trackfleet:automation] tick", {
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    notificationsSent,
  });

  return {
    connected: true,
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    notificationsSent,
  };
}
