import { shouldCreateDelayEvent } from "./automation-delay.ts";
import { knownSite } from "./known-sites.ts";
import { destinationPointFor, distanceKm } from "./route-progress.ts";
import { buildEtaObservation } from "./eta-observation.ts";
import { buildEtaRouteContexts, stableEtaRouteContext } from "./route-history.ts";
import { buildTruckStopPlans } from "./truck-stop-plan.ts";
import { stablePlanRouteTemplateId } from "./route-learning.ts";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "./trip-record.ts";
import { canonicalFleetVehicleId } from "./vehicle-identity.ts";
import type { DeliveryStore } from "./delivery-store.types.ts";
import type { SendatrackSnapshot } from "./sendatrack.ts";

export type ArrivalCompletionObserver = (input: {
  companyId: string;
  deliveryId: string;
  insideArrivalZone: boolean;
  observationAt: Date;
  unloadGraceMinutes: number;
}) => Promise<{
  justEntered: boolean;
  deliveredNow: boolean;
  arrivalSiteSince: Date | null;
}>;

export type FleetBusinessTickResult = {
  vehicles: number;
  transitions: number;
  newEvents: number;
  delayEvents: number;
  arrivalSiteEvents: number;
  automaticCompletions: number;
  etaObservations: number;
  fleetPositions: number;
};

type FleetBusinessTickInput = {
  snapshot: SendatrackSnapshot;
  companyId: string;
  unloadGraceMinutes: number;
  store: DeliveryStore;
  observeArrivalCompletion: ArrivalCompletionObserver;
  observedAt?: Date;
  automationStartAt?: Date | null;
  // Per-company overrides (see CompanyAutomationSettings) for the relay-leg
  // completion below. Both optional and defaulted here -- callers that don't
  // pass them (the accelerated regression scenario, older tests) keep today's
  // fixed 24h/always-on behavior unchanged.
  ctmRelayGraceMinutes?: number;
  ctmRelayAutoCompletionEnabled?: boolean;
};

/**
 * Runs the deterministic business portion of one automation tick. External
 * provider access, notifications, heartbeat persistence and retention remain
 * in the server orchestrator; this function is shared by production and the
 * accelerated end-to-end regression scenario.
 */
export async function runFleetBusinessTick(input: FleetBusinessTickInput): Promise<FleetBusinessTickResult> {
  const { snapshot, companyId, unloadGraceMinutes, store, observeArrivalCompletion } = input;
  const tickObservedAt = input.observedAt ?? new Date();

  // A single tick touches the same delivery's events from up to three
  // separate loops below (transition handling, manual-arrival completion,
  // and the per-delivery ETA/delay pass). Each store.listEvents call is a
  // real DB round trip, and re-fetching unchanged events three times per
  // delivery was a major contributor to a production outage where the tick
  // exceeded the Worker's subrequest budget every single run. Caching per
  // delivery within the tick -- and invalidating only when this tick itself
  // inserts a new event for that delivery -- keeps results correct while
  // cutting redundant round trips.
  const eventsCache = new Map<string, Awaited<ReturnType<typeof store.listEvents>>>();
  const eventsFor = async (deliveryId: string) => {
    const cached = eventsCache.get(deliveryId);
    if (cached) return cached;
    const events = await store.listEvents(deliveryId);
    eventsCache.set(deliveryId, events);
    return events;
  };
  const recordEventTracked: typeof store.recordEvent = async (deliveryId, type, progress) => {
    const inserted = await store.recordEvent(deliveryId, type, progress);
    if (inserted) eventsCache.delete(deliveryId);
    return inserted;
  };
  const fleetPositionResults = await Promise.all(snapshot.vehicles.map((vehicle) => store.recordFleetPosition({
    companyId,
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
  let newEvents = 0;
  let delayEvents = 0;
  let arrivalSiteEvents = 0;
  let automaticCompletions = 0;
  const observedArrivalIds = new Set<string>();

  for (const transition of transitions) {
    for (const type of transition.events) {
      if (await recordEventTracked(transition.delivery.id, type, transition.delivery.progress)) newEvents += 1;
    }

    const delivery = transition.delivery;
    const arrivalEvents = await eventsFor(delivery.id);
    const manuallyConfirmedArrival = arrivalEvents.some((event) => event.type === "MANUAL_ARRIVAL_CONFIRMED");
    const hasPosition = typeof delivery.latitude === "number"
      && typeof delivery.longitude === "number"
      && delivery.lastPositionAt instanceof Date;
    let insideArrivalZone = manuallyConfirmedArrival;
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
      insideArrivalZone = manuallyConfirmedArrival || delivery.status !== "Loading"
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
    observedArrivalIds.add(delivery.id);
    if (completion.justEntered && await recordEventTracked(delivery.id, "ARRIVED_AT_SITE", Math.min(99, delivery.progress))) {
      newEvents += 1;
      arrivalSiteEvents += 1;
    }
    if (completion.deliveredNow) {
      newEvents += 1;
      automaticCompletions += 1;
    }
  }

  // A human-confirmed arrival must keep advancing through unloading even when
  // SENDATRACK has no fresh vehicle in this tick. The explicit confirmation is
  // the arrival evidence; subsequent ticks only measure the configured grace.
  const manualArrivalCandidates = await store.listForCompany(companyId);
  for (const delivery of manualArrivalCandidates) {
    if (delivery.status === "Delivered" || observedArrivalIds.has(delivery.id)) continue;
    const events = await eventsFor(delivery.id);
    if (!events.some((event) => event.type === "MANUAL_ARRIVAL_CONFIRMED")) continue;
    const completion = await observeArrivalCompletion({
      companyId,
      deliveryId: delivery.id,
      insideArrivalZone: true,
      observationAt: tickObservedAt,
      unloadGraceMinutes,
    });
    if (completion.justEntered && await recordEventTracked(delivery.id, "ARRIVED_AT_SITE", Math.min(99, delivery.progress))) {
      newEvents += 1;
      arrivalSiteEvents += 1;
    }
    if (completion.deliveredNow) {
      newEvents += 1;
      automaticCompletions += 1;
    }
  }

  // Relay deliveries (see KnownSite.finalLegTrackingUnavailable) have no GPS
  // confirmation of the actual destination at all -- the site is one our
  // GPS-tracked trucks never physically visit. Once positions go stale past
  // the confirmed hub (the same signal the customer tracking page uses to
  // switch to the CTM notice -- see relayInEffect in page.tsx), there's no
  // "inside arrival zone" signal to wait for, so this doesn't reuse the
  // physical-unloading dwell above. Instead, assume CTM's relay leg takes a
  // fixed duration (24h by default, per-company override above) and reuse
  // the same dwell-timer infrastructure with that as the grace period.
  // ARRIVED_AT_SITE is recorded only once that grace period completes (not
  // on "justEntered", unlike the loops above) -- recording it immediately
  // when CTM merely takes over would fire the customer WhatsApp notification
  // at the start of the relay leg instead of when the parcel is actually
  // expected to have arrived. A company can disable this loop entirely
  // (ctmRelayAutoCompletionEnabled === false) if it would rather every relay
  // arrival wait for an explicit manual confirmation instead.
  if (input.ctmRelayAutoCompletionEnabled !== false) {
    const ctmRelayGraceMinutes = input.ctmRelayGraceMinutes ?? 24 * 60;
    for (const delivery of manualArrivalCandidates) {
      if (delivery.status === "Delivered" || observedArrivalIds.has(delivery.id)) continue;
      if (knownSite(delivery.destinationSiteId)?.finalLegTrackingUnavailable !== true) continue;
      const hasPosition = typeof delivery.latitude === "number"
        && typeof delivery.longitude === "number"
        && delivery.lastPositionAt instanceof Date;
      if (!hasPosition) continue;
      const positionAgeMinutes = Math.max(0, (tickObservedAt.getTime() - delivery.lastPositionAt!.getTime()) / 60_000);
      if (positionAgeMinutes <= 30) continue;
      const completion = await observeArrivalCompletion({
        companyId,
        deliveryId: delivery.id,
        insideArrivalZone: true,
        observationAt: tickObservedAt,
        unloadGraceMinutes: ctmRelayGraceMinutes,
      });
      observedArrivalIds.add(delivery.id);
      if (completion.deliveredNow && await recordEventTracked(delivery.id, "ARRIVED_AT_SITE", 100)) {
        newEvents += 1;
        arrivalSiteEvents += 1;
        automaticCompletions += 1;
      }
    }
  }

  const deliveries = await store.listForCompany(companyId);
  const routeContexts = buildEtaRouteContexts(deliveries);
  const stableContexts = new Map<string, ReturnType<typeof stableEtaRouteContext>>();
  let etaObservations = 0;
  for (const delivery of deliveries) {
    // listForCompany returns every delivery a company has ever created, not
    // just active ones -- without this guard, ETA/registration/delay work
    // (multiple DB round trips each) reprocesses the company's entire
    // historical delivery volume on every tick forever, which was a major
    // contributor to the automation tick reliably exceeding the Worker's
    // subrequest budget. A delivered parcel is done: it needs no further ETA
    // observations, delay detection, or trip-position logging, and a
    // REGISTERED backfill notification arriving after the parcel already
    // arrived would be a confusing, out-of-order message anyway. Trip
    // completion detection below is unaffected -- it reads `deliveries`
    // directly (via rowById) rather than this loop's stableContexts, and
    // buildTruckStopPlans already excludes delivered deliveries from stops.
    if (delivery.status === "Delivered") continue;
    let events = await eventsFor(delivery.id);
    const automationStartAt = input.automationStartAt ?? null;
    const registrationEligible = automationStartAt
      && delivery.createdAt.getTime() >= automationStartAt.getTime()
      && !events.some((event) => event.type === "REGISTERED");
    if (registrationEligible && await recordEventTracked(delivery.id, "REGISTERED", delivery.progress)) {
      newEvents += 1;
      events = await eventsFor(delivery.id);
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
    if (await recordEventTracked(delivery.id, "DELAY_DETECTED", delivery.progress)) {
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
      status: tripStatusFromDeliveryStatuses(deliveryIds.flatMap((id) => {
        const status = rowById.get(id)?.status;
        return status ? [status] : [];
      })),
    });
    activeTripIds.add(persistedTrip.id);
    await Promise.all(deliveryIds.map((deliveryId) => store.assignDeliveryTrip(deliveryId, companyId, persistedTrip.id)));
  }

  const persistedTrips = await store.listTrips(companyId, 500);
  for (const trip of persistedTrips) {
    if (trip.status === "completed" || activeTripIds.has(trip.id)) continue;
    const deliveryIds = await store.listDeliveryIdsForTrip(companyId, trip.id);
    const statuses = deliveryIds.flatMap((id) => {
      const status = rowById.get(id)?.status;
      return status ? [status] : [];
    });
    if (tripStatusFromDeliveryStatuses(statuses) !== "completed") continue;
    await store.upsertTrip({
      id: trip.id,
      companyId: trip.companyId,
      routeTemplateId: trip.routeTemplateId,
      vehicleKey: trip.vehicleKey,
      truck: trip.truck,
      sendatrackVehicleId: trip.sendatrackVehicleId,
      originSiteId: trip.originSiteId,
      stops: trip.stops,
      status: "completed",
    });
  }

  return {
    vehicles: snapshot.vehicles.length,
    transitions: transitions.length,
    newEvents,
    delayEvents,
    arrivalSiteEvents,
    automaticCompletions,
    etaObservations,
    fleetPositions,
  };
}
