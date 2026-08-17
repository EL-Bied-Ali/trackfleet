import { store } from "trackfleet-delivery-store";
import { shouldCreateDelayEvent } from "./automation-delay";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { processPendingNotifications } from "./notification-runner";
import { getSendatrackSnapshot } from "./sendatrack";
import { buildEtaObservation } from "./eta-observation";
import { buildEtaRouteContexts, stableEtaRouteContext } from "./route-history";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  delayEvents: number;
  notificationsSent: number;
  notificationFailures: number;
  etaObservations: number;
};

export async function runFleetAutomation(origin: string): Promise<AutomationRunResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");

  const snapshot = await getSendatrackSnapshot();
  if (!snapshot.connected) {
    return { connected: false, vehicles: snapshot.vehicles.length, transitions: 0, newEvents: 0, delayEvents: 0, notificationsSent: 0, notificationFailures: 0, etaObservations: 0 };
  }

  const companyId = await companyIdForAccount(accountID);
  const transitions = await store.applySendatrackSnapshot(snapshot, companyId);
  let newEvents = 0;
  let delayEvents = 0;

  for (const transition of transitions) {
    for (const type of transition.events) {
      if (await store.recordEvent(transition.delivery.id, type, transition.delivery.progress)) newEvents += 1;
    }
  }

  const deliveries = await store.listForCompany(companyId);
  const routeContexts = buildEtaRouteContexts(deliveries);
  let etaObservations = 0;
  for (const delivery of deliveries) {
    const events = await store.listEvents(delivery.id);
    const previousEtaObservations = await store.listEtaObservations(delivery.id, 2000);
    const routeContext = stableEtaRouteContext(routeContexts.get(delivery.id) ?? null, previousEtaObservations, events);
    const etaObservation = buildEtaObservation(delivery, events, deliveries, routeContext);
    if (etaObservation && await store.recordEtaObservation(etaObservation)) etaObservations += 1;
    if (routeContext && delivery.gpsSource === "sendatrack" && delivery.sendatrackVehicleId && typeof delivery.latitude === "number" && typeof delivery.longitude === "number" && delivery.lastPositionAt) {
      await store.recordTripPosition({
        companyId, routeTemplateId: routeContext.routeTemplateId, tripInstanceId: routeContext.tripInstanceId, vehicleId: delivery.sendatrackVehicleId,
        positionAt: delivery.lastPositionAt, latitude: delivery.latitude, longitude: delivery.longitude, speed: delivery.speed ?? 0,
      });
    }
    if (!shouldCreateDelayEvent(delivery, events, deliveries)) continue;
    if (await store.recordEvent(delivery.id, "DELAY_DETECTED", delivery.progress)) {
      newEvents += 1;
      delayEvents += 1;
    }
  }

  const notifications = await processPendingNotifications(companyId, origin);
  console.info("[trackfleet:automation] tick", {
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    delayEvents,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations,
  });

  return {
    connected: true,
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    delayEvents,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations,
  };
}
