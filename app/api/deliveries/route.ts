import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { siteStore } from "trackfleet-site-store";
import type { DeliveryTransition } from "../../lib/delivery-store.types";
import { shouldDetectDelay } from "../../lib/delay-detection";
import { customerFacingEvent } from "../../lib/delivery-events";
import { estimateArrival } from "../../lib/eta-estimator";
import { resolveKnownSite } from "../../lib/known-sites";
import { processPendingNotifications } from "../../lib/notification-runner";
import { publicDeliveryView } from "../../lib/public-delivery-view";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";
import { calculateRouteMetrics, rebaseRouteMetrics } from "../../lib/route-progress";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { buildTruckStopPlans, pendingServiceMinutesBefore, pendingServiceMinutesBeforeWithHistory } from "../../lib/truck-stop-plan";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";
import { publicTrackingIsActive, trackingExpiresAt } from "../../lib/tracking-access";
import { normalizeCustomerPhone } from "../../lib/customer-contact";
import { findCompanySiteByText, resolveExplicitCompanySite } from "../../lib/delivery-site-resolution";
import { matchDeliveryVehicle } from "../../lib/vehicle-linking";
import { buildEtaRouteContexts, stableEtaRouteContext, summarizeRouteHistory } from "../../lib/route-history";
import { summarizeStopDwell } from "../../lib/stop-dwell";
import { routeLearningState, stablePlanRouteTemplateId } from "../../lib/route-learning";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "../../lib/trip-record";
import { summarizeCompletedTripRoutes } from "../../lib/trip-history-summary";

function errorResponse(error: unknown) {
  console.error("[trackfleet:deliveries] request failed", {
    message: error instanceof Error ? error.message : "unknown_error",
  });
  return Response.json({ error: "internal_error" }, { status: 500, headers: { "cache-control": "no-store" } });
}

function explicitDestination(row: { destinationLatitude?: number | null; destinationLongitude?: number | null }): [number, number] | null {
  return typeof row.destinationLatitude === "number" && typeof row.destinationLongitude === "number"
    ? [row.destinationLongitude, row.destinationLatitude]
    : null;
}
function explicitOrigin(row: { originLatitude?: number | null; originLongitude?: number | null }): [number, number] | null {
  return typeof row.originLatitude === "number" && typeof row.originLongitude === "number"
    ? [row.originLongitude, row.originLatitude]
    : null;
}

function enrichDelivery<T extends {
  latitude: number | null;
  longitude: number | null;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destination: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  lastPositionAt: Date | null;
  plannedArrivalAt?: Date | null;
  status?: string;
}>(
  row: T,
  events: Awaited<ReturnType<typeof store.listEvents>> = [],
  futureServiceMinutes = 0,
  historicalEffectiveSpeedKmh: number | null = null,
  historicalTripCount = 0,
) {
  const origin = explicitOrigin(row);
  const baselineProgress = origin ? 0 : (events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0);
  const absoluteMetrics = typeof row.latitude === "number" && typeof row.longitude === "number"
    ? calculateRouteMetrics(row.latitude, row.longitude, row.destination, explicitDestination(row), origin)
    : null;
  const metrics = absoluteMetrics ? rebaseRouteMetrics(absoluteMetrics, baselineProgress) : null;
  const positionAgeMinutes = row.lastPositionAt ? Math.max(0, Math.round((Date.now() - row.lastPositionAt.getTime()) / 60_000)) : null;
  const departedAt = events.find((event) => event.type === "DEPARTED")?.createdAt ?? null;
  const completedDistanceKm = metrics ? Math.max(0, metrics.routeDistanceKm - metrics.remainingDistanceKm) : null;
  const etaEstimate = estimateArrival({
    remainingDistanceKm: metrics?.remainingDistanceKm ?? null,
    completedDistanceKm,
    departedAt,
    lastPositionAt: row.lastPositionAt,
    plannedArrivalAt: row.plannedArrivalAt ?? null,
    delivered: row.status === "Delivered",
    futureServiceMinutes,
    historicalEffectiveSpeedKmh,
    historicalTripCount,
  });

  return {
    ...row,
    routeDistanceKm: metrics ? Math.round(metrics.routeDistanceKm) : null,
    remainingDistanceKm: metrics ? Math.round(metrics.remainingDistanceKm) : null,
    distanceToDestinationKm: metrics ? Math.round(metrics.distanceToDestinationKm) : null,
    positionAgeMinutes,
    gpsFresh: positionAgeMinutes !== null && positionAgeMinutes <= 30,
    estimatedArrivalAt: etaEstimate.estimatedArrivalAt?.toISOString() ?? null,
    etaDelayMinutes: etaEstimate.delayMinutes,
    etaConfidence: etaEstimate.confidence,
    etaSource: etaEstimate.source,
    effectiveSpeedKmh: etaEstimate.effectiveSpeedKmh === null ? null : Math.round(etaEstimate.effectiveSpeedKmh),
    pendingStopServiceMinutes: futureServiceMinutes,
    etaHistoryTrips: historicalTripCount,
    etaHistoricalSpeedKmh: historicalEffectiveSpeedKmh === null ? null : Math.round(historicalEffectiveSpeedKmh),
    trackingExpiresAt: "createdAt" in row && row.createdAt instanceof Date ? trackingExpiresAt({ plannedArrivalAt: row.plannedArrivalAt ?? null, createdAt: row.createdAt }).toISOString() : null,
  };
}

async function enrichAndDetectDelay<T extends {
  id: string;
  progress: number;
  latitude: number | null;
  longitude: number | null;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destination: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  lastPositionAt: Date | null;
  plannedArrivalAt?: Date | null;
  status: string;
}>(row: T, futureServiceMinutes = 0, historicalEffectiveSpeedKmh: number | null = null, historicalTripCount = 0) {
  let events = await store.listEvents(row.id);
  let delivery = enrichDelivery(row, events, futureServiceMinutes, historicalEffectiveSpeedKmh, historicalTripCount);
  const delayDetected = shouldDetectDelay({
    eta: {
      estimatedArrivalAt: delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt) : null,
      effectiveSpeedKmh: delivery.effectiveSpeedKmh,
      delayMinutes: delivery.etaDelayMinutes,
      confidence: delivery.etaConfidence,
      source: delivery.etaSource,
    },
    delivered: row.status === "Delivered",
    alreadyDetected: events.some((event) => event.type === "DELAY_DETECTED"),
  });

  if (delayDetected && await store.recordEvent(row.id, "DELAY_DETECTED", row.progress)) {
    events = await store.listEvents(row.id);
    delivery = enrichDelivery(row, events, futureServiceMinutes, historicalEffectiveSpeedKmh, historicalTripCount);
  }

  return { delivery, events };
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
async function learnedStopMinutes(companyId: string, routeTemplateId: string | null, currentTripInstanceId: string | null, prefetchedSites?: Awaited<ReturnType<typeof siteStore.listForCompany>>) {
  const learned = new Map<string, number>();
  if (!routeTemplateId) return learned;
  const [positions, sites] = await Promise.all([
    store.listTripPositionsForRoute(companyId, routeTemplateId, 20000),
    prefetchedSites ? Promise.resolve(prefetchedSites) : siteStore.listForCompany(companyId),
  ]);
  for (const site of sites) {
    if (typeof site.latitude !== "number" || typeof site.longitude !== "number") continue;
    const stats = summarizeStopDwell(positions, { latitude: site.latitude, longitude: site.longitude, arrivalRadiusKm: site.arrivalRadiusKm }, 3, currentTripInstanceId);
    if (stats.usableMinutes !== null) learned.set(site.id, stats.usableMinutes);
  }
  return learned;
}

async function persistTransitionEvents(transitions: DeliveryTransition[]) {
  for (const transition of transitions) {
    for (const type of transition.events) {
      await store.recordEvent(transition.delivery.id, type, transition.delivery.progress);
    }
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const tracking = requestUrl.searchParams.get("tracking")?.trim();
    if (tracking) {
      const row = await store.getPublic(tracking);
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      if (!publicTrackingIsActive(row)) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      // Public tracking is strictly read-only. It may use tenant-scoped data
      // already persisted by authenticated refreshes or automation, but it must
      // never create delivery events or trigger outbound notifications.
      const companyRows = await store.listForCompany(row.companyId);
      const routeContexts = buildEtaRouteContexts(companyRows);
      const routeEvents = await store.listEvents(row.id);
      const ownEtaHistory = await store.listEtaObservations(row.id, 2000);
      const routeContext = stableEtaRouteContext(routeContexts.get(row.id) ?? null, ownEtaHistory, routeEvents);
      const historyRows = routeContext ? await store.listEtaObservationsForRoute(routeContext.routeTemplateId, routeContext.destinationSiteId) : [];
      const history = summarizeRouteHistory(historyRows, 5, routeContext?.tripInstanceId ?? null);
      const learnedDwell = await learnedStopMinutes(row.companyId, routeContext?.routeTemplateId ?? null, routeContext?.tripInstanceId ?? null);
      const serviceMinutes = pendingServiceMinutesBeforeWithHistory(row, companyRows, learnedDwell);
      const enriched = enrichDelivery(row, routeEvents, serviceMinutes, history.usableEffectiveSpeedKmh, history.tripCount);
      return Response.json({
        deliveries: [publicDeliveryView(enriched)],
        events: routeEvents.filter((event) => customerFacingEvent(event.type)),
        publicTracking: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const integration = await getSendatrackSnapshot(session.credentials);
    const transitions = await store.applySendatrackSnapshot(integration, session.companyId);
    await persistTransitionEvents(transitions);
    const rows = await store.listForCompany(session.companyId);
    const companySites = await siteStore.listForCompany(session.companyId);
    const siteById = new Map(companySites.map((site) => [site.id, site]));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const stopPlans = buildTruckStopPlans(rows);
    const routeContexts = buildEtaRouteContexts(rows, stopPlans);
    const etaHistoryCache = new Map<string, Promise<Awaited<ReturnType<typeof store.listEtaObservationsForRoute>>>>();
    const dwellCache = new Map<string, Promise<Map<string, number>>>();
    const cachedEtaHistory = (routeTemplateId: string, destinationSiteId: string) => {
      const key = `${routeTemplateId}|${destinationSiteId}`;
      let pending = etaHistoryCache.get(key);
      if (!pending) {
        pending = store.listEtaObservationsForRoute(routeTemplateId, destinationSiteId);
        etaHistoryCache.set(key, pending);
      }
      return pending;
    };
    const cachedLearnedDwell = (routeTemplateId: string | null, tripInstanceId: string | null) => {
      const key = `${routeTemplateId ?? "none"}|${tripInstanceId ?? "none"}`;
      let pending = dwellCache.get(key);
      if (!pending) {
        pending = learnedStopMinutes(session.companyId, routeTemplateId, tripInstanceId, companySites);
        dwellCache.set(key, pending);
      }
      return pending;
    };
    const stableContexts = new Map<string, ReturnType<typeof stableEtaRouteContext>>();
    const enrichedRows = await Promise.all(rows.map(async (row) => {
      const routeEvents = await store.listEvents(row.id);
      const ownEtaHistory = await store.listEtaObservations(row.id, 2000);
      const routeContext = stableEtaRouteContext(routeContexts.get(row.id) ?? null, ownEtaHistory, routeEvents);
      stableContexts.set(row.id, routeContext);
      const historyRows = routeContext ? await cachedEtaHistory(routeContext.routeTemplateId, routeContext.destinationSiteId) : [];
      const history = summarizeRouteHistory(historyRows, 5, routeContext?.tripInstanceId ?? null);
      const learnedDwell = await cachedLearnedDwell(routeContext?.routeTemplateId ?? null, routeContext?.tripInstanceId ?? null);
      const serviceMinutes = pendingServiceMinutesBeforeWithHistory(row, rows, learnedDwell);
      return (await enrichAndDetectDelay(row, serviceMinutes, history.usableEffectiveSpeedKmh, history.tripCount)).delivery;
    }));
    const stopPlansWithLearning = await Promise.all(stopPlans.map(async (plan) => {
      const deliveryIds = plan.stops.flatMap((stop) => stop.deliveryIds);
      const stableRouteTemplateId = stablePlanRouteTemplateId(plan.routeTemplateId, deliveryIds, stableContexts);
      const currentTripInstanceId = plan.tripId ?? deliveryIds.map((id) => stableContexts.get(id)?.tripInstanceId).find(Boolean) ?? null;
      const finalStop = plan.stops[plan.stops.length - 1] ?? null;
      const historyRows = finalStop ? await cachedEtaHistory(stableRouteTemplateId, finalStop.siteId) : [];
      const history = summarizeRouteHistory(historyRows, 5, currentTripInstanceId);
      const learnedDwell = await cachedLearnedDwell(stableRouteTemplateId, currentTripInstanceId);
      const futureStopIds = plan.stops.slice(0, -1).map((stop) => stop.siteId);
      const unconfiguredStops = futureStopIds.filter((siteId) => {
        const site = siteById.get(siteId);
        return !site || typeof site.latitude !== "number" || typeof site.longitude !== "number";
      }).length;
      const learning = routeLearningState({
        historicalTrips: history.tripCount,
        learnedStops: futureStopIds.filter((siteId) => learnedDwell.has(siteId)).length,
        futureStops: futureStopIds.length,
        unconfiguredStops,
        medianEffectiveSpeedKmh: history.medianEffectiveSpeedKmh,
        medianDelayMinutes: history.medianDelayMinutes,
      });
      if (!currentTripInstanceId) return { ...plan, routeTemplateId: stableRouteTemplateId, tripInstanceId: currentTripInstanceId, learning };
      const persistedTrip = await store.upsertTrip({
        id: currentTripInstanceId,
        companyId: session.companyId,
        routeTemplateId: stableRouteTemplateId,
        vehicleKey: plan.vehicleKey,
        truck: plan.truck,
        sendatrackVehicleId: plan.sendatrackVehicleId,
        originSiteId: plan.originSiteId,
        stops: tripStopsFromPlan(plan.stops),
        status: tripStatusFromDeliveryStatuses(deliveryIds.flatMap((id) => { const status = rowById.get(id)?.status; return status ? [status] : []; })),
      });
      await Promise.all(deliveryIds.map((deliveryId) => store.assignDeliveryTrip(deliveryId, session.companyId, persistedTrip.id)));
      return { ...plan, routeTemplateId: persistedTrip.routeTemplateId, tripInstanceId: persistedTrip.id, learning };
    }));

    const activeTripIds = new Set(stopPlansWithLearning.map((plan) => plan.tripInstanceId).filter((id): id is string => Boolean(id)));
    const persistedTrips = await store.listTrips(session.companyId, 500);
    for (const trip of persistedTrips) {
      if (trip.status === "completed" || activeTripIds.has(trip.id)) continue;
      const deliveryIds = await store.listDeliveryIdsForTrip(session.companyId, trip.id);
      const statuses = deliveryIds.flatMap((id) => { const status = rowById.get(id)?.status; return status ? [status] : []; });
      if (tripStatusFromDeliveryStatuses(statuses) !== "completed") continue;
      await store.upsertTrip({
        id: trip.id, companyId: trip.companyId, routeTemplateId: trip.routeTemplateId, vehicleKey: trip.vehicleKey,
        truck: trip.truck, sendatrackVehicleId: trip.sendatrackVehicleId, originSiteId: trip.originSiteId, stops: trip.stops, status: "completed",
      });
    }

    await processPendingNotifications(session.companyId, requestUrl.origin);

    const allTripsForHistory = await store.listTrips(session.companyId, 500);
    const routeHistory = summarizeCompletedTripRoutes(allTripsForHistory).map((route) => ({
      routeTemplateId: route.routeTemplateId,
      originSiteId: route.originSiteId,
      destinationSiteIds: route.destinationSiteIds,
      destinations: route.destinations,
      tripCount: route.tripCount,
      trucks: route.trucks,
      lastCompletedAt: route.lastCompletedAt.toISOString(),
    }));
    const tripHistory = allTripsForHistory.slice(0, 20).map((trip) => ({
      id: trip.id,
      routeTemplateId: trip.routeTemplateId,
      vehicleKey: trip.vehicleKey,
      truck: trip.truck,
      sendatrackVehicleId: trip.sendatrackVehicleId,
      originSiteId: trip.originSiteId,
      stops: trip.stops,
      status: trip.status,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    }));

    return Response.json({
      deliveries: enrichedRows,
      stopPlans: stopPlansWithLearning,
      trips: tripHistory,
      routeHistory,
      features: {
        whatsappDemoEnabled: runtimeEnv.WHATSAPP_DEMO_ENABLED === "true",
      },
      integration: {
        configured: integration.configured,
        connected: integration.connected,
        vehicleCount: integration.vehicles.length,
        error: integration.error ?? null,
        vehicles: integration.vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name, speed: vehicle.speed, updatedAt: vehicle.updatedAt, latitude: vehicle.latitude, longitude: vehicle.longitude })),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

    const payload = (await request.json()) as Record<string, unknown>;
    const customer = String(payload.customer ?? "").trim();
    const destinationInput = String(payload.destination ?? "").trim();
    const originSiteInput = String(payload.originSiteId ?? "").trim();
    const destinationSiteId = String(payload.destinationSiteId ?? "").trim();
    const companySites = await siteStore.listForCompany(session.companyId);
    const originSelection = resolveExplicitCompanySite(companySites, originSiteInput);
    if (originSelection.invalid) return Response.json({ error: "origin site is not available for this company" }, { status: 400 });
    const destinationSelection = resolveExplicitCompanySite(companySites, destinationSiteId);
    if (destinationSelection.invalid) return Response.json({ error: "destination site is not available for this company" }, { status: 400 });
    const originSite = originSelection.site;
    const site = destinationSelection.site ?? findCompanySiteByText(companySites, destinationInput) ?? resolveKnownSite(destinationInput);
    const destination = site?.address ?? destinationInput;
    const truck = String(payload.truck ?? "").trim();
    const sendatrackVehicleId = String(payload.sendatrackVehicleId ?? "").trim();
    const eta = String(payload.eta ?? "").trim();
    const plannedArrivalRaw = String(payload.plannedArrivalAt ?? "").trim();
    const parsedPlannedArrival = plannedArrivalRaw ? new Date(plannedArrivalRaw) : null;
    const plannedArrivalAt = parsedPlannedArrival && Number.isFinite(parsedPlannedArrival.getTime()) ? parsedPlannedArrival : null;
    const validLegacyEta = /^\d{2}:\d{2}$/.test(eta);
    if (!customer || !destination || !truck || (!plannedArrivalAt && !validLegacyEta)) {
      return Response.json({ error: "customer, destination, truck, and a valid planned arrival are required" }, { status: 400 });
    }

    const contactInput = String(payload.contact ?? "").trim();
    const contact = normalizeCustomerPhone(contactInput);
    if (contact === null) {
      return Response.json({ error: "contact must use an international phone format, for example +212... or +32..." }, { status: 400 });
    }
    const whatsappOptIn = payload.whatsappOptIn === true;
    if (whatsappOptIn && !contact) {
      return Response.json({ error: "WhatsApp consent requires a valid customer phone number" }, { status: 400 });
    }

    const requestedDestinationLatitude = optionalNumber(payload.destinationLatitude);
    const requestedDestinationLongitude = optionalNumber(payload.destinationLongitude);
    if ((requestedDestinationLatitude === null) !== (requestedDestinationLongitude === null)) {
      return Response.json({ error: "destinationLatitude and destinationLongitude must be provided together" }, { status: 400 });
    }
    const destinationLatitude = requestedDestinationLatitude ?? site?.latitude ?? null;
    const destinationLongitude = requestedDestinationLongitude ?? site?.longitude ?? null;
    if (destinationLatitude !== null && (destinationLatitude < -90 || destinationLatitude > 90 || destinationLongitude! < -180 || destinationLongitude! > 180)) {
      return Response.json({ error: "invalid destination coordinates" }, { status: 400 });
    }
    const requestedRadius = optionalNumber(payload.arrivalRadiusKm);
    const arrivalRadiusKm = Math.max(0.05, Math.min(10, requestedRadius ?? site?.arrivalRadiusKm ?? 0.5));
    const exactDestination: [number, number] | null = destinationLatitude !== null && destinationLongitude !== null
      ? [destinationLongitude, destinationLatitude]
      : null;

    const snapshot = await getSendatrackSnapshot(session.credentials);
    const liveVehicle = matchDeliveryVehicle({ sendatrackVehicleId, truck }, snapshot.vehicles).vehicle;
    const originLatitude = liveVehicle?.latitude ?? originSite?.latitude ?? null;
    const originLongitude = liveVehicle?.longitude ?? originSite?.longitude ?? null;
    const exactOrigin: [number, number] | null = originLatitude !== null && originLongitude !== null
      ? [originLongitude, originLatitude]
      : null;
    const baselineMetrics = liveVehicle
      ? calculateRouteMetrics(liveVehicle.latitude, liveVehicle.longitude, destination, exactDestination, exactOrigin)
      : null;

    const delivery = await store.create({
      customer,
      originSiteId: originSite?.id ?? null,
      originLatitude,
      originLongitude,
      destinationSiteId: site?.id ?? null,
      destination,
      destinationLatitude,
      destinationLongitude,
      arrivalRadiusKm,
      truck: liveVehicle?.name ?? truck,
      eta: validLegacyEta ? eta : plannedArrivalAt!.toISOString().slice(11, 16),
      plannedArrivalAt,
      contact,
      whatsappOptIn,
      whatsappOptInAt: whatsappOptIn ? new Date() : null,
      sendatrackVehicleId: liveVehicle?.id ?? sendatrackVehicleId,
      companyId: session.companyId,
      trackingToken: createTrackingToken(),
      driver: "To be assigned", status: "Loading", progress: 0, color: "#916ed7",
      latitude: liveVehicle?.latitude ?? originLatitude, longitude: liveVehicle?.longitude ?? originLongitude,
      speed: liveVehicle?.speed ?? null, lastPositionAt: liveVehicle ? new Date(liveVehicle.updatedAt) : null,
      gpsSource: liveVehicle ? "sendatrack" : "simulation",
    });
    if (baselineMetrics) await store.recordEvent(delivery.id, "GPS_BASELINE", baselineMetrics.progress);
    await store.recordEvent(delivery.id, "REGISTERED", delivery.progress);
    await processPendingNotifications(session.companyId, new URL(request.url).origin);

    const rows = await store.listForCompany(session.companyId);
    const serviceMinutes = pendingServiceMinutesBefore(delivery, rows);
    const enriched = await enrichAndDetectDelay(delivery, serviceMinutes);
    return Response.json({ delivery: enriched.delivery }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}