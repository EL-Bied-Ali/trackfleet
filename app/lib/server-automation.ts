import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { processPendingNotifications } from "./notification-runner";
import { getSendatrackSnapshot } from "./sendatrack";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  notificationsSent: number;
  notificationFailures: number;
};

export async function runFleetAutomation(origin: string): Promise<AutomationRunResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");

  const snapshot = await getSendatrackSnapshot();
  if (!snapshot.connected) {
    return { connected: false, vehicles: snapshot.vehicles.length, transitions: 0, newEvents: 0, notificationsSent: 0, notificationFailures: 0 };
  }

  const companyId = await companyIdForAccount(accountID);
  const transitions = await store.applySendatrackSnapshot(snapshot, companyId);
  let newEvents = 0;

  for (const transition of transitions) {
    for (const type of transition.events) {
      if (await store.recordEvent(transition.delivery.id, type, transition.delivery.progress)) newEvents += 1;
    }
  }

  const notifications = await processPendingNotifications(companyId, origin);
  console.info("[trackfleet:automation] tick", {
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
  });

  return {
    connected: true,
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
  };
}
