import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { pruneTelemetry } from "trackfleet-telemetry-retention";
import { shouldCreateDelayEvent } from "./automation-delay";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { parseUnloadGraceMinutes } from "./delivery-arrival";
import { processPendingNotifications } from "./notification-runner";
import { parseAutomationStartAt } from "./notification-policy";
import { distanceKm, destinationPointFor } from "./route-progress";
import { getSendatrackSnapshot } from "./sendatrack";
import { buildEtaObservation } from "./eta-observation";
import { buildEtaRouteContexts, stableEtaRouteContext } from "./route-history";
import { buildTruckStopPlans } from "./truck-stop-plan";
import { stablePlanRouteTemplateId } from "./route-learning";
import { telemetryRetentionPolicy } from "./telemetry-retention";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "./trip-record";
import { canonicalFleetVehicleId } from "./vehicle-identity";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  delayEvents: number;
  arrivalSiteEvents: number;
  automaticCompletions: number;
  notificationsSent: number;
  notificationFailures: number;
  etaObservations: number;
  fleetPositions: number;
  telemetryPruned: number;
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
      delayEvents: 0,
      arrivalSiteEvents: 0,
      automaticCompletions: 0,
      notificationsSent: 0,
      notificationFailures: 0,
      etaObservations: 0,
      fleetPositions: 0,
      telemetryPruned: 0,
    };
  }

  const companyId = await companyIdForAccount(accountID);
  const fleetPositionResults = await Promise.all(snapshot.vehicles.map((vehicle) => store.recordFleetPosition({
    companyId,
    // Provider ids can change shape across SENDATRACK payloads (v3, tk00x,
    // fmb920, ...). Telemetry therefore uses the physical truck label/plate
    // as its canonical identity while provider ids remain available for live
    // delivery linking.
    vehicleId: canonicalFleetVehicleId(vehicle.name, vehicle.providerDeviceId || vehicle.id),
    vehicleName: vehicle.name,
    positionAt: new Date(vehicle.updatedAt),
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    speed: vehicle.speed,
    heading: vehicle.heading,
    address: vehicle.address,
  })));
  const fleetPositions = fleetPositionResults.filter(Boolean).length;
  const transitions = await store.applySendatrackSnapshot(snapshot, companyId);
  const unloadGraceMinutes = parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
  let newEvents = 0;
  let delayEvents = 0;
  let arrivalSiteEvents = 0;
  let automaticCompletions = 0;

  for (const transition of transitions) {
    for (const type of transition.events) {
      if (await store.recordEvent(transition.delivery.id, type, transition.delivery.progress)) newEvents += 1;
    }

    const delivery = transition.delivery;
    const tickObservedAt = new Date();
    const hasPosition = typeof delivery.latitude === "number"
      && typeof delivery.longitude === "number"
      && delivery.lastPositionAt instanceof Date;
    let insideArrivalZone = false;
    if (hasPosition) {
      const positionAt = delivery.lastPositionAt!;
      const destinationPoint = destinationPointFor(
        delivery.destination,
        typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
          ? [delivery.destinationLongitude, delivery.destinationLatitude]
          : null,
      );
      const distanceToDestinationKm = distanceKm([delivery.longitude!, delivery.latitude!], destinationPoint);
      const positionAgeMinutes = Math.max(0, (tickObservedAt.getTime() - positionAt.getTime()) / 60_000);
      const radiusKm = Math.max(0.05, Math.min(10, delivery.arrivalRadiusKm || 0.5));
      insideArrivalZone = delivery.status !== "Loading"
        && positionAgeMinutes <= 30
        && distanceToDestinationKm <= radiusKm
        && (delivery.speed ?? 0) <= 5;
    }

    const completion = await observeArrivalCompletion({
      companyId,
      deliveryId: delivery.id,
      insideArrivalZone,
      observationAt: tickObservedAt,
      unloadGraceMinutes,
    });
    if (completion.justEntered && await store.recordEvent(delivery.id, "ARRIVED_AT_SITE", Math.min(99, delivery.progress))) {
      newEvents += 1;
      arrivalSiteEvents += 1;
    }
    if (completion.deliveredNow) {
      newEvents += 1;
      automaticCompletions += 1;
    }
  }

  const deliveries = await store.listForCompany(companyId);
  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);
  const routeContexts = buildEtaRouteContexts(deliveries);
  const stableContexts = new Map<string, ReturnType<typeof stableEtaRouteContext>>();
  let etaObservations = 0;
  for (const delivery of deliveries) {
    let events = await store.listEvents(delivery.id);

    const registrationEligible = automationStartAt
      && delivery.createdAt.getTime() >= automationStartAt.getTime()
      && !events.some((event) => event.type === "REGISTERED");
    if (registrationEligible && await store.recordEvent(delivery.id, "REGISTERED", delivery.progress)) {
      newEvents += 1;
      events = await store.listEvents(delivery.id);
    }

    const previousEtaObservations = await store.listEtaObservations(delivery.id, 2000);
    const routeContext = stableEtaRouteContext(routeContexts.get(delivery.id) ?? null, previousEtaObservations, events);
    stableContexts.set(delivery.id, routeContext);
    const etaObservation = buildEtaObservation(delivery, events, deliveries, routeContext);
    if (etaObservation && await store.recordEtaObservation(etaObservation)) etaObservations += 1;
    if (routeContext && delivery.gpsSource === "sendatrack" && delivery.sendatrackVehicleId && typeof delivery.latitude === "number" && typeof delivery.longitude === "number" && delivery.lastPositionAt) {
      await store.recordTripPosition({
        companyId,
        routeTemplateId: routeContext.routeTemplateId,
        tripInstanceId: routeContext.tripInstanceId,
        vehicleId: canonicalFleetVehicleId(delivery.truck, delivery.sendatrackVehicleId),
        positionAt: delivery.lastPositionAt,
        latitude: delivery.latitude,
        longitude: delivery.longitude,
        speed: delivery.speed ?? 0,
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
  let telemetryPruned = 0;
  const retention = telemetryRetentionPolicy(runtimeEnv.TRACKFLEET_TELEMETRY_RETENTION_DAYS);
  if (retention.valid && retention.days !== null) {
    try {
      const pruned = await pruneTelemetry(companyId, retention.days);
      telemetryPruned = pruned.fleetPositions + pruned.tripPositions + pruned.etaObservations;
    } catch (error) {
      console.error("[trackfleet:automation] telemetry retention maintenance failed", {
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  console.info("[trackfleet:automation] tick", {
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    delayEvents,
    arrivalSiteEvents,
    automaticCompletions,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations,
    fleetPositions,
    telemetryPruned,
  });

  return {
    connected: true,
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    delayEvents,
    arrivalSiteEvents,
    automaticCompletions,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations,
    fleetPositions,
    telemetryPruned,
  };
}
