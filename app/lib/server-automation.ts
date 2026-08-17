import { store } from "trackfleet-delivery-store";
import { shouldCreateDelayEvent } from "./automation-delay";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { processPendingNotifications } from "./notification-runner";
import { getSendatrackSnapshot } from "./sendatrack";
import { buildEtaObservation } from "./eta-observation";
import { buildEtaRouteContexts, stableEtaRouteContext } from "./route-history";
import { buildTruckStopPlans } from "./truck-stop-plan";
import { stablePlanRouteTemplateId } from "./route-learning";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "./trip-record";

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
  const stableContexts = new Map<string, ReturnType<typeof stableEtaRouteContext>>();
  let etaObservations = 0;
  for (const delivery of deliveries) {
    const events = await store.listEvents(delivery.id);
    const previousEtaObservations = await store.listEtaObservations(delivery.id, 2000);
    const routeContext = stableEtaRouteContext(routeContexts.get(delivery.id) ?? null, previousEtaObservations, events);
    stableContexts.set(delivery.id, routeContext);
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

  const rowById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const plans = buildTruckStopPlans(deliveries);
  const activeTripIds = new Set<string>();
  for (const plan of plans) {
    const deliveryIds = plan.stops.flatMap((stop) => stop.deliveryIds);
    const routeTemplateId = stablePlanRouteTemplateId(plan.routeTemplateId, deliveryIds, stableContexts);
    const tripInstanceId = plan.tripId ?? deliveryIds.map((id) => stableContexts.get(id)?.tripInstanceId).find(Boolean) ?? null;
    if (!tripInstanceId) continue;
    const persistedTrip = await store.upsertTrip({
      id: tripInstanceId,
      companyId,
      routeTemplateId,
      vehicleKey: plan.vehicleKey,
      truck: plan.truck,
      sendatrackVehicleId: plan.sendatrackVehicleId,
      originSiteId: plan.originSiteId,
      stops: tripStopsFromPlan(plan.stops),
      status: tripStatusFromDeliveryStatuses(deliveryIds.flatMap((id) => { const status = rowById.get(id)?.status; return status ? [status] : []; })),
    });
    activeTripIds.add(persistedTrip.id);
    await Promise.all(deliveryIds.map((deliveryId) => store.assignDeliveryTrip(deliveryId, companyId, persistedTrip.id)));
  }

  const persistedTrips = await store.listTrips(companyId, 500);
  for (const trip of persistedTrips) {
    if (trip.status === "completed" || activeTripIds.has(trip.id)) continue;
    const deliveryIds = await store.listDeliveryIdsForTrip(companyId, trip.id);
    const statuses = deliveryIds.flatMap((id) => { const status = rowById.get(id)?.status; return status ? [status] : []; });
    if (tripStatusFromDeliveryStatuses(statuses) !== "completed") continue;
    await store.upsertTrip({
      id: trip.id, companyId: trip.companyId, routeTemplateId: trip.routeTemplateId, vehicleKey: trip.vehicleKey,
      truck: trip.truck, sendatrackVehicleId: trip.sendatrackVehicleId, originSiteId: trip.originSiteId, stops: trip.stops, status: "completed",
    });
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
