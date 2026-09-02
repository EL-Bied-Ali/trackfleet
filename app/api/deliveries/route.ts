import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { siteStore } from "trackfleet-site-store";
import type { DeliveryRow } from "../../lib/delivery-store.types";
import { deliveryIdempotencyPayloadMatches, deliveryIdempotencyTrackingToken, validDeliveryIdempotencyKey } from "../../lib/delivery-idempotency";
import { shouldDetectDelay } from "../../lib/delay-detection";
import { customerFacingEvent, trackingLinkExpiryAnchorFromEvents } from "../../lib/delivery-events";
import { estimateArrival } from "../../lib/eta-estimator";
import { computeDeliveryPrice, deliveryPriceCurrencyForOriginCountry } from "../../lib/delivery-pricing";
import { estimateRelayArrival } from "../../lib/relay-eta-estimate";
import { getManualArrivalDurationEstimates, type ManualArrivalDurationEstimate } from "../../lib/manual-arrival-duration.postgres";
import { getDepartureArrivalDurationEstimates } from "../../lib/departure-arrival-duration.postgres";
import { knownSite, resolveKnownSite } from "../../lib/known-sites";
import { processPendingNotifications } from "../../lib/notification-runner";
import { publicDeliveryView } from "../../lib/public-delivery-view";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";
import { calculateRouteMetrics, rebaseRouteMetrics } from "../../lib/route-progress";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { buildTruckStopPlans, pendingServiceMinutesBefore, pendingServiceMinutesBeforeWithHistory } from "../../lib/truck-stop-plan";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";
import { getCompanyBranding } from "trackfleet-auth-session-store";
import { getSubscription, subscriptionGrantsAccess, whatsappIncludedInPlan } from "../../lib/subscription-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { publicTrackingIsActive, publicTrackingTokenIsValid, trackingExpiresAt } from "../../lib/tracking-access";
import { normalizeCustomerEmail, normalizeCustomerPhone } from "../../lib/customer-contact";
import { createParcelCode } from "../../lib/parcel-code";
import { findCompanySiteByText, resolveExplicitCompanySite } from "../../lib/delivery-site-resolution";
import { matchDeliveryVehicle } from "../../lib/vehicle-linking";
import { buildEtaRouteContexts, stableEtaRouteContext, summarizeRouteHistory } from "../../lib/route-history";
import { groupPositionsByTrip, summarizeStopDwellFromGroupedTrips } from "../../lib/stop-dwell";
import { routeLearningState, stablePlanRouteTemplateId } from "../../lib/route-learning";
import { tripStatusFromDeliveryStatuses, tripStopsFromPlan } from "../../lib/trip-record";
import { summarizeCompletedTripRoutes } from "../../lib/trip-history-summary";

const SHIPMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

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
  manualArrivalEstimate: ManualArrivalDurationEstimate | null = null,
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
    trackingExpiresAt: "createdAt" in row && row.createdAt instanceof Date ? trackingExpiresAt({ plannedArrivalAt: row.plannedArrivalAt ?? null, createdAt: row.createdAt, deliveredAt: trackingLinkExpiryAnchorFromEvents(events) }).toISOString() : null,
    manualArrivalEstimateHours: manualArrivalEstimate?.medianHours ?? null,
    manualArrivalEstimateSampleCount: manualArrivalEstimate?.sampleCount ?? 0,
    labelPrintRequestedAt: events.find((event) => event.type === "LABEL_PRINT_REQUESTED")?.createdAt.toISOString() ?? null,
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
  destinationSiteId?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  lastPositionAt: Date | null;
  plannedArrivalAt?: Date | null;
  status: string;
}>(row: T, futureServiceMinutes = 0, historicalEffectiveSpeedKmh: number | null = null, historicalTripCount = 0, manualArrivalEstimate: ManualArrivalDurationEstimate | null = null, prefetchedEvents?: Awaited<ReturnType<typeof store.listEvents>>) {
  // The dashboard's own loop (GET, below) already batch-fetches every
  // delivery's events in one company-scoped query and passes them in here --
  // falling back to a per-delivery fetch only for the single-delivery POST
  // call site, where there's nothing to batch against.
  let events = prefetchedEvents ?? await store.listEvents(row.id);
  let delivery = enrichDelivery(row, events, futureServiceMinutes, historicalEffectiveSpeedKmh, historicalTripCount, manualArrivalEstimate);
  const delayDetected = shouldDetectDelay({
    eta: {
      estimatedArrivalAt: delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt) : null,
      effectiveSpeedKmh: delivery.effectiveSpeedKmh,
      delayMinutes: delivery.etaDelayMinutes,
      confidence: delivery.etaConfidence,
      source: delivery.etaSource,
    },
    delivered: row.status === "Delivered" || events.some((event) => event.type === "ARRIVED_AT_SITE"),
    alreadyDetected: events.some((event) => event.type === "DELAY_DETECTED"),
    finalLegTrackingUnavailable: knownSite(row.destinationSiteId)?.finalLegTrackingUnavailable === true,
  });

  if (delayDetected && await store.recordEvent(row.id, "DELAY_DETECTED", row.progress)) {
    events = await store.listEvents(row.id);
    delivery = enrichDelivery(row, events, futureServiceMinutes, historicalEffectiveSpeedKmh, historicalTripCount, manualArrivalEstimate);
  }

  return { delivery, events };
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// A phone number can appear across several deliveries (repeat customer,
// or as both sender and recipient over time). Consent must be resolved
// per phone number, not per delivery: find the most recent grant and the
// most recent withdrawal across every delivery where the number appears,
// and let whichever happened last win. Stopping at the first matching
// delivery (the previous implementation) meant a withdrawal recorded on
// one delivery could be silently overridden by an older, still-active
// grant sitting on a different delivery for the same number.
async function rememberedConsentForPhone(deliveries: DeliveryRow[], phone: string) {
  if (!phone) return false;
  let mostRecentGrant: Date | null = null;
  let mostRecentWithdrawal: Date | null = null;
  for (const delivery of deliveries) {
    const customerMatches = normalizeCustomerPhone(delivery.contact) === phone;
    const recipientMatches = normalizeCustomerPhone(delivery.recipientContact ?? "") === phone;
    if (!customerMatches && !recipientMatches) continue;

    if (customerMatches && delivery.whatsappOptIn === true && delivery.whatsappOptInAt) {
      if (!mostRecentGrant || delivery.whatsappOptInAt > mostRecentGrant) mostRecentGrant = delivery.whatsappOptInAt;
    }
    if (recipientMatches && delivery.recipientWhatsappOptIn === true && delivery.recipientWhatsappOptInAt) {
      if (!mostRecentGrant || delivery.recipientWhatsappOptInAt > mostRecentGrant) mostRecentGrant = delivery.recipientWhatsappOptInAt;
    }

    const events = await store.listEvents(delivery.id);
    const withdrawal = events.find((event) => event.type === "WHATSAPP_OPT_OUT");
    if (withdrawal && (!mostRecentWithdrawal || withdrawal.createdAt > mostRecentWithdrawal)) {
      mostRecentWithdrawal = withdrawal.createdAt;
    }
  }
  if (!mostRecentGrant) return false;
  return !mostRecentWithdrawal || mostRecentGrant > mostRecentWithdrawal;
}

async function idempotentReplayResponse(delivery: DeliveryRow, companyId: string) {
  const [events, rows] = await Promise.all([
    store.listEvents(delivery.id),
    store.listForCompany(companyId),
  ]);
  const serviceMinutes = pendingServiceMinutesBefore(delivery, rows);
  return Response.json({
    delivery: enrichDelivery(delivery, events, serviceMinutes),
    idempotentReplay: true,
  }, { status: 200, headers: { "cache-control": "no-store" } });
}

async function learnedStopMinutes(companyId: string, routeTemplateId: string | null, currentTripInstanceId: string | null, prefetchedSites?: Awaited<ReturnType<typeof siteStore.listForCompany>>) {
  const learned = new Map<string, number>();
  if (!routeTemplateId) return learned;
  const [positions, sites] = await Promise.all([
    store.listTripPositionsForRoute(companyId, routeTemplateId, 20000),
    prefetchedSites ? Promise.resolve(prefetchedSites) : siteStore.listForCompany(companyId),
  ]);
  // Grouping/sorting the position history is identical regardless of which
  // site is being checked -- done once here and reused for every site,
  // instead of summarizeStopDwell repeating it per site (see
  // groupPositionsByTrip's comment in stop-dwell.ts).
  const groupedTrips = groupPositionsByTrip(positions, currentTripInstanceId);
  for (const site of sites) {
    if (typeof site.latitude !== "number" || typeof site.longitude !== "number") continue;
    const stats = summarizeStopDwellFromGroupedTrips(groupedTrips, { latitude: site.latitude, longitude: site.longitude, arrivalRadiusKm: site.arrivalRadiusKm }, 3);
    if (stats.usableMinutes !== null) learned.set(site.id, stats.usableMinutes);
  }
  return learned;
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const tracking = requestUrl.searchParams.get("tracking")?.trim();
    if (tracking) {
      if (!publicTrackingTokenIsValid(tracking)) {
        return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
      }
      const row = await store.getPublic(tracking);
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      // Public tracking is strictly read-only. It may use tenant-scoped data
      // already persisted by authenticated refreshes or automation, but it must
      // never create delivery events or trigger outbound notifications.
      const routeEvents = await store.listEvents(row.id);

      if (!publicTrackingIsActive({ plannedArrivalAt: row.plannedArrivalAt, createdAt: row.createdAt, deliveredAt: trackingLinkExpiryAnchorFromEvents(routeEvents) })) {
        return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
      }

      const companyRows = await store.listForCompany(row.companyId);
      const routeContexts = buildEtaRouteContexts(companyRows);
      const ownEtaHistory = await store.listEtaObservations(row.id, 2000);
      const routeContext = stableEtaRouteContext(routeContexts.get(row.id) ?? null, ownEtaHistory, routeEvents);
      const historyRows = routeContext ? await store.listEtaObservationsForRoute(row.companyId, routeContext.routeTemplateId, routeContext.destinationSiteId) : [];
      const history = summarizeRouteHistory(historyRows, 5, routeContext?.tripInstanceId ?? null);
      const learnedDwell = await learnedStopMinutes(row.companyId, routeContext?.routeTemplateId ?? null, routeContext?.tripInstanceId ?? null);
      const serviceMinutes = pendingServiceMinutesBeforeWithHistory(row, companyRows, learnedDwell);
      // Only worth the extra read for destinations beyond the GPS-tracked
      // relay -- every other delivery already gets a real GPS-based ETA.
      const manualArrivalEstimate = knownSite(row.destinationSiteId)?.finalLegTrackingUnavailable === true
        ? (await getManualArrivalDurationEstimates(row.companyId)).get(row.destinationSiteId!) ?? null
        : null;
      const enriched = enrichDelivery(row, routeEvents, serviceMinutes, history.usableEffectiveSpeedKmh, history.tripCount, manualArrivalEstimate);
      const companyBranding = await getCompanyBranding(row.companyId);
      // Only looked up once the parcel is genuinely Delivered -- avoids an
      // extra subrequest on every single (much more frequent) in-transit
      // tracking page view, and matches publicDeliveryView's own contract:
      // never reveal a number to call before there's actually someone there.
      const destinationWhatsapp = enriched.status === "Delivered" && row.destinationSiteId
        ? (await siteStore.listForCompany(row.companyId)).find((site) => site.id === row.destinationSiteId)?.whatsapp ?? null
        : null;
      return Response.json({
        deliveries: [publicDeliveryView(enriched, { destinationWhatsapp })],
        events: routeEvents.filter((event) => customerFacingEvent(event.type)),
        publicTracking: true,
        // Per-company, not per-delivery, so it travels as its own top-level
        // field rather than inside publicDeliveryView's allowlist -- the
        // customer tracking page shows the actual shipping company's own
        // name/logo instead of "TrackFleet", falling back to the generic
        // brand when a company hasn't configured one.
        companyBranding: companyBranding ?? { name: null, logoDataUrl: null, color: null },
      }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const subscription = await getSubscription(session.companyId);
    if (!subscriptionGrantsAccess(subscription?.status ?? null)) {
      return Response.json({ error: "subscription_required" }, { status: 402, headers: { "cache-control": "no-store" } });
    }

    // Keep this read endpoint inside the Worker's tight interactive CPU
    // budget. The live SENDATRACK snapshot is fetched concurrently by the UI
    // through /api/sendatrack, which gives provider parsing its own Worker
    // invocation. Persisted delivery GPS/state continues to be refreshed by
    // the native scheduled automation tick.
    const rows = await store.listForCompany(session.companyId);
    // getManualArrivalDurationEstimates joins against a vehicle's entire GPS
    // history and is real CPU-ms work regardless of how tight its own
    // internal caps are (see manual-arrival-duration.postgres.ts) -- it's
    // only ever useful when at least one non-Delivered delivery is actually
    // headed to a relay-only site, so skip it entirely otherwise instead of
    // paying that cost on every dispatcher page load unconditionally.
    const needsManualArrivalEstimates = rows.some((row) => row.status !== "Delivered"
      && row.destinationSiteId
      && knownSite(row.destinationSiteId)?.finalLegTrackingUnavailable === true);
    const companyDeliveryIds = rows.map((row) => row.id);
    const [companySites, manualArrivalEstimates, departureArrivalEstimates, scanSummaries, eventsByDeliveryId, etaHistoryByDeliveryId] = await Promise.all([
      siteStore.listForCompany(session.companyId),
      needsManualArrivalEstimates ? getManualArrivalDurationEstimates(session.companyId) : Promise.resolve(new Map<string, ManualArrivalDurationEstimate>()),
      // Unlike manualArrivalEstimates above, this isn't gated behind an
      // existing in-flight delivery to a relay site: the creation form and
      // schedule editor need it available before any delivery to that
      // agency exists yet. Cheap regardless (bounded to a handful of known
      // relay sites, no GPS join -- see departure-arrival-duration.postgres.ts).
      getDepartureArrivalDurationEstimates(session.companyId),
      // A single, company-scoped read powers every parcel-control indicator
      // in the table. Never fan this out into one scan query per delivery.
      store.listScanSummaries(session.companyId, companyDeliveryIds),
      // Same reasoning, for the two per-delivery queries the enrichment loop
      // below used to run in a loop (store.listEvents / listEtaObservations
      // once each per delivery) -- at real trip/delivery volume that alone
      // was enough to exceed the Worker's per-invocation subrequest budget
      // and 500 this entire route for every dispatcher (2026-09-02).
      store.listEventsForDeliveries(session.companyId, companyDeliveryIds),
      store.listEtaObservationsForDeliveries(session.companyId, companyDeliveryIds, 2000),
    ]);
    const scanSummaryByDeliveryId = new Map(scanSummaries.map((summary) => [summary.deliveryId, summary]));
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
        pending = store.listEtaObservationsForRoute(session.companyId, routeTemplateId, destinationSiteId);
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
      const routeEvents = eventsByDeliveryId.get(row.id) ?? [];
      const ownEtaHistory = etaHistoryByDeliveryId.get(row.id) ?? [];
      const routeContext = stableEtaRouteContext(routeContexts.get(row.id) ?? null, ownEtaHistory, routeEvents);
      stableContexts.set(row.id, routeContext);
      const historyRows = routeContext ? await cachedEtaHistory(routeContext.routeTemplateId, routeContext.destinationSiteId) : [];
      const history = summarizeRouteHistory(historyRows, 5, routeContext?.tripInstanceId ?? null);
      const learnedDwell = await cachedLearnedDwell(routeContext?.routeTemplateId ?? null, routeContext?.tripInstanceId ?? null);
      const serviceMinutes = pendingServiceMinutesBeforeWithHistory(row, rows, learnedDwell);
      const manualArrivalEstimate = row.destinationSiteId ? manualArrivalEstimates.get(row.destinationSiteId) ?? null : null;
      return (await enrichAndDetectDelay(row, serviceMinutes, history.usableEffectiveSpeedKmh, history.tripCount, manualArrivalEstimate, routeEvents)).delivery;
    }));
    const enrichedRowsWithScans = enrichedRows.map((delivery) => ({
      ...delivery,
      scanSummary: scanSummaryByDeliveryId.get(delivery.id) ?? null,
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
      // assignDeliveryTrip's own WHERE clause (trip_id IS NULL OR trip_id =
      // tripId) already makes it a no-op once a delivery's trip_id matches --
      // but calling it at all still costs one subrequest per delivery, on
      // every single dashboard load, forever, regardless of whether anything
      // actually needs writing. Only deliveries not yet assigned to this
      // trip need the call; already-correct rows use rows fetched earlier in
      // this same request instead of paying for a write that would change
      // nothing.
      const unassignedDeliveryIds = deliveryIds.filter((deliveryId) => rowById.get(deliveryId)?.tripId !== persistedTrip.id);
      await Promise.all(unassignedDeliveryIds.map((deliveryId) => store.assignDeliveryTrip(deliveryId, session.companyId, persistedTrip.id)));
      return { ...plan, routeTemplateId: persistedTrip.routeTemplateId, tripInstanceId: persistedTrip.id, learning };
    }));

    const activeTripIds = new Set(stopPlansWithLearning.map((plan) => plan.tripInstanceId).filter((id): id is string => Boolean(id)));
    const persistedTrips = await store.listTrips(session.companyId, 500);
    // Every delivery's tripId is already sitting in `rows` (fetched once,
    // above) -- re-querying store.listDeliveryIdsForTrip per trip here was a
    // redundant DB round trip for data this same request already has, and at
    // real trip-history volume (dozens of trips) it was enough on its own to
    // blow the Worker's per-invocation subrequest budget, 500ing this whole
    // route with "Too many subrequests" for every dispatcher.
    const deliveryIdsByTripId = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.tripId) continue;
      const existing = deliveryIdsByTripId.get(row.tripId);
      if (existing) existing.push(row.id); else deliveryIdsByTripId.set(row.tripId, [row.id]);
    }
    const justCompletedTripIds = new Set<string>();
    for (const trip of persistedTrips) {
      if (trip.status === "completed" || activeTripIds.has(trip.id)) continue;
      const deliveryIds = deliveryIdsByTripId.get(trip.id) ?? [];
      const statuses = deliveryIds.flatMap((id) => { const status = rowById.get(id)?.status; return status ? [status] : []; });
      if (tripStatusFromDeliveryStatuses(statuses) !== "completed") continue;
      await store.upsertTrip({
        id: trip.id, companyId: trip.companyId, routeTemplateId: trip.routeTemplateId, vehicleKey: trip.vehicleKey,
        truck: trip.truck, sendatrackVehicleId: trip.sendatrackVehicleId, originSiteId: trip.originSiteId, stops: trip.stops, status: "completed",
      });
      justCompletedTripIds.add(trip.id);
    }

    // Re-querying store.listTrips here (identical params to persistedTrips
    // above) was another pure-waste subrequest on every dashboard load --
    // patch in the completions this same request just wrote instead of
    // re-fetching the whole list a second time.
    const allTripsForHistory = justCompletedTripIds.size === 0 ? persistedTrips
      : persistedTrips.map((trip) => justCompletedTripIds.has(trip.id) ? { ...trip, status: "completed" as const } : trip);
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

    const visibleRows = session.role === "agency"
      ? enrichedRowsWithScans.filter((delivery) => agencyDeliveryIsVisible(delivery, session.siteId))
      : enrichedRowsWithScans;

    return Response.json({
      deliveries: visibleRows,
      stopPlans: session.role === "dispatcher" ? stopPlansWithLearning : [],
      trips: session.role === "dispatcher" ? tripHistory : [],
      routeHistory: session.role === "dispatcher" ? routeHistory : [],
      // Keyed by destinationSiteId, so the creation form and schedule editor
      // can preview the same learned transit duration estimateRelayArrival
      // will use server-side, before any delivery to that agency exists in
      // `deliveries` to read it off of (see relay-eta-estimate.ts).
      departureArrivalEstimates: Object.fromEntries(departureArrivalEstimates),
      features: {
        whatsappDemoEnabled: session.role === "dispatcher" && runtimeEnv.WHATSAPP_DEMO_ENABLED === "true",
        // Lets the new-delivery form hide (rather than misleadingly show) the
        // WhatsApp opt-in checkbox for a Standard-tier company -- otherwise a
        // dispatcher could collect a customer's opt-in for something that
        // silently never sends (see whatsappIncludedInPlan in
        // subscription-store.ts, the exact same rule notification-runner.ts
        // gates actual sends on).
        whatsappAvailable: whatsappIncludedInPlan(subscription),
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
    const subscription = await getSubscription(session.companyId);
    if (!subscriptionGrantsAccess(subscription?.status ?? null)) {
      return Response.json({ error: "subscription_required" }, { status: 402, headers: { "cache-control": "no-store" } });
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (idempotencyKey && !validDeliveryIdempotencyKey(idempotencyKey)) {
      return Response.json({ error: "invalid_idempotency_key" }, { status: 400, headers: { "cache-control": "no-store" } });
    }

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();
    const customer = String(payload.customer ?? "").trim();
    const destinationInput = String(payload.destination ?? "").trim();
    const submittedOriginSiteInput = String(payload.originSiteId ?? "").trim();
    const originSiteInput = session.role === "agency" ? session.siteId : submittedOriginSiteInput;
    const destinationSiteId = String(payload.destinationSiteId ?? "").trim();
    const truck = String(payload.truck ?? "").trim();
    const sendatrackVehicleId = String(payload.sendatrackVehicleId ?? "").trim();
    const eta = String(payload.eta ?? "").trim();
    const plannedArrivalRaw = String(payload.plannedArrivalAt ?? "").trim();
    const nextTruckDepartureRaw = String(payload.nextTruckDepartureAt ?? "").trim();
    const contactInput = String(payload.contact ?? "").trim();
    const customerEmailInput = String(payload.customerEmail ?? "").trim();
    const recipientName = String(payload.recipientName ?? "").trim();
    const recipientContactInput = String(payload.recipientContact ?? "").trim();
    const weightProvided = payload.weightKg !== null && payload.weightKg !== undefined && String(payload.weightKg).trim() !== "";
    const weightInput = optionalNumber(payload.weightKg);
    const manualPriceProvided = payload.manualPriceAmount !== null && payload.manualPriceAmount !== undefined && String(payload.manualPriceAmount).trim() !== "";
    const manualPriceInput = optionalNumber(payload.manualPriceAmount);
    const itemDescriptionInput = String(payload.itemDescription ?? "").trim();
    // Client asked: payment tracking (paid/partial/unpaid) is editable at
    // creation just like weight/price, defaulting to "unpaid" -- separate
    // from priceAmount/priceCurrency itself, which stays the trusted
    // billing figure regardless of what's actually been collected.
    const paymentStatusInput = String(payload.paymentStatus ?? "unpaid").trim();
    const amountPaidInput = optionalNumber(payload.amountPaid);
    // Client-generated (not server-assigned) so a dispatcher entering several
    // parcels for one customer in one sitting can link them by generating one
    // id up front and sending it with each parcel's create call -- each
    // parcel is still its own independent request/resource, this is purely a
    // grouping key stamped on each row. Optional: absent for ordinary
    // single-parcel submissions.
    const shipmentIdInput = String(payload.shipmentId ?? "").trim();
    if (shipmentIdInput && !SHIPMENT_ID_PATTERN.test(shipmentIdInput)) {
      return Response.json({ error: "shipmentId must be 8-128 characters of letters, numbers, '.', '_', ':' or '-'" }, { status: 400 });
    }
    if (
      customer.length > 160
      || destinationInput.length > 500
      || originSiteInput.length > 100
      || destinationSiteId.length > 100
      || truck.length > 160
      || sendatrackVehicleId.length > 160
      || eta.length > 16
      || plannedArrivalRaw.length > 64
      || nextTruckDepartureRaw.length > 64
      || contactInput.length > 40
      || customerEmailInput.length > 254
      || recipientName.length > 160
      || recipientContactInput.length > 40
      || itemDescriptionInput.length > 200
    ) {
      return Response.json({ error: "delivery fields exceed allowed length" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    if (weightProvided && (weightInput === null || weightInput <= 0 || weightInput > 100000)) {
      return Response.json({ error: "weightKg must be greater than 0 and at most 100000" }, { status: 400 });
    }
    if (manualPriceProvided && (manualPriceInput === null || manualPriceInput <= 0 || manualPriceInput > 1000000)) {
      return Response.json({ error: "manualPriceAmount must be greater than 0 and at most 1000000" }, { status: 400 });
    }
    if (!["unpaid", "partial", "paid"].includes(paymentStatusInput)) {
      return Response.json({ error: "paymentStatus must be one of unpaid, partial, paid" }, { status: 400 });
    }
    if (paymentStatusInput === "partial" && (amountPaidInput === null || amountPaidInput <= 0)) {
      return Response.json({ error: "amountPaid must be greater than 0 when paymentStatus is partial" }, { status: 400 });
    }
    // A parcel with no declared weight (a bulky item priced manually -- a TV,
    // a washing machine) has nothing else in the table distinguishing it from
    // any other unweighed parcel, so a description of what it actually is
    // becomes mandatory exactly when weight is absent.
    if (!weightProvided && !itemDescriptionInput) {
      return Response.json({ error: "itemDescription is required when weightKg is not provided" }, { status: 400 });
    }
    const weightKg = weightInput === null ? null : Math.round(weightInput * 1000) / 1000;
    const companySites = await siteStore.listForCompany(session.companyId);
    const originSelection = resolveExplicitCompanySite(companySites, originSiteInput);
    if (originSelection.invalid) return Response.json({ error: "origin site is not available for this company" }, { status: 400 });
    const destinationSelection = resolveExplicitCompanySite(companySites, destinationSiteId);
    if (destinationSelection.invalid) return Response.json({ error: "destination site is not available for this company" }, { status: 400 });
    const originSite = originSelection.site;
    // Price defaults to the declared weight (1.5 EUR/kg, or 15 MAD/kg from
    // Morocco), but the client asked for it to be fully editable -- a
    // dispatcher-entered manualPriceAmount now overrides the weight-derived
    // figure whenever it's explicitly present, same trusted mechanism
    // bulky items (washing machines, TVs -- no declared weight) already
    // used, just no longer restricted to only the no-weight case.
    const { priceAmount, priceCurrency } = manualPriceInput !== null && manualPriceInput > 0
      ? { priceAmount: Math.round(manualPriceInput * 100) / 100, priceCurrency: deliveryPriceCurrencyForOriginCountry(originSite?.country ?? null) }
      : weightKg !== null
        ? computeDeliveryPrice(weightKg, originSite?.country ?? null)
        : { priceAmount: null, priceCurrency: null };
    if (paymentStatusInput === "partial" && priceAmount !== null && amountPaidInput !== null && amountPaidInput >= priceAmount) {
      return Response.json({ error: "amountPaid must be less than the delivery's price for a partial payment -- use paymentStatus 'paid' instead" }, { status: 400 });
    }
    const amountPaid = paymentStatusInput === "partial" ? amountPaidInput : null;
    const site = destinationSelection.site ?? findCompanySiteByText(companySites, destinationInput) ?? resolveKnownSite(destinationInput);
    const destination = site?.address ?? destinationInput;
    const parsedPlannedArrival = plannedArrivalRaw ? new Date(plannedArrivalRaw) : null;
    const submittedPlannedArrivalAt = parsedPlannedArrival && Number.isFinite(parsedPlannedArrival.getTime()) ? parsedPlannedArrival : null;
    const parsedNextTruckDeparture = nextTruckDepartureRaw ? new Date(nextTruckDepartureRaw) : null;
    const nextTruckDepartureAt = parsedNextTruckDeparture && Number.isFinite(parsedNextTruckDeparture.getTime()) ? parsedNextTruckDeparture : null;
    // The dispatcher only ever enters a departure date -- the arrival
    // estimate is derived server-side from the destination's quoted CTM
    // relay transit window (see relay-eta-estimate.ts), the same trusted,
    // never-client-supplied computation pattern already used for price. A
    // client-submitted plannedArrivalAt only survives as a fallback for a
    // destination with no relay window configured. Once enough real
    // door-to-door durations have been confirmed for this specific agency
    // (see departure-arrival-duration.postgres.ts), that learned median
    // replaces the fixed hub-wide quote -- skipped entirely for a
    // non-relay destination, where it would always be empty anyway.
    const learnedTransitEstimate = knownSite(destinationSiteId)?.finalLegTrackingUnavailable === true
      ? (await getDepartureArrivalDurationEstimates(session.companyId)).get(destinationSiteId) ?? null
      : null;
    const plannedArrivalAt = estimateRelayArrival(destinationSiteId, nextTruckDepartureAt, learnedTransitEstimate) ?? submittedPlannedArrivalAt;
    const validLegacyEta = /^\d{2}:\d{2}$/.test(eta);
    if (!customer || !destination || !truck || !originSiteInput) {
      return Response.json({ error: "customer, destination, truck, and originSiteId are required" }, { status: 400 });
    }
    const normalizedEta = validLegacyEta ? eta : plannedArrivalAt ? plannedArrivalAt.toISOString().slice(11, 16) : "";

    const contact = normalizeCustomerPhone(contactInput);
    if (contact === null) {
      return Response.json({ error: "contact must use an international phone format, for example +212... or +32..." }, { status: 400 });
    }
    const customerEmail = normalizeCustomerEmail(customerEmailInput);
    if (customerEmail === null) {
      return Response.json({ error: "customerEmail must be a valid email address" }, { status: 400 });
    }
    const recipientContact = normalizeCustomerPhone(recipientContactInput);
    if (recipientContact === null) {
      return Response.json({ error: "recipientContact must use an international phone format, for example +212... or +32..." }, { status: 400 });
    }
    if (Boolean(recipientName) !== Boolean(recipientContact)) {
      return Response.json({ error: "recipientName and recipientContact must be provided together" }, { status: 400 });
    }
    const explicitWhatsappConsent = payload.whatsappOptIn === true;
    if (explicitWhatsappConsent && !contact && !recipientContact) {
      return Response.json({ error: "WhatsApp consent requires at least one valid phone number" }, { status: 400 });
    }
    const existingDeliveries = await store.listForCompany(session.companyId);
    const [customerConsentRemembered, recipientConsentRemembered] = await Promise.all([
      rememberedConsentForPhone(existingDeliveries, contact),
      rememberedConsentForPhone(existingDeliveries, recipientContact),
    ]);
    const whatsappOptIn = Boolean(contact) && (explicitWhatsappConsent || customerConsentRemembered);
    const recipientWhatsappOptIn = Boolean(recipientContact) && (explicitWhatsappConsent || recipientConsentRemembered);

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

    const idempotencyTrackingToken = idempotencyKey
      ? await deliveryIdempotencyTrackingToken(session.companyId, idempotencyKey)
      : null;
    if (idempotencyTrackingToken) {
      const existing = await store.getPublic(idempotencyTrackingToken);
      if (existing) {
        if (existing.companyId !== session.companyId) throw new Error("idempotency_token_collision");
        if (session.role === "agency" && !agencyDeliveryIsVisible(existing, session.siteId)) {
          return Response.json({ error: "idempotency_key_conflict" }, { status: 409, headers: { "cache-control": "no-store" } });
        }
        if (!deliveryIdempotencyPayloadMatches(existing, { customer, destination, contact, customerEmail: customerEmail || null, recipientName, recipientContact, eta: normalizedEta, plannedArrivalAt, nextTruckDepartureAt, weightKg, priceAmount, priceCurrency, itemDescription: itemDescriptionInput || null })) {
          return Response.json({ error: "idempotency_key_conflict" }, { status: 409, headers: { "cache-control": "no-store" } });
        }
        return idempotentReplayResponse(existing, session.companyId);
      }
    }

    // Resolved only to normalize the truck name/id below -- no mid-route
    // pickups in this business, so a brand-new delivery never captures the
    // assigned truck's live GPS position as its own baseline (see the
    // matching change in delivery-store.postgres.ts's applySendatrackSnapshot
    // /linkVehicle). It stays origin-anchored and untracked until the parcel
    // is actually scanned "chargé" onto that truck; the automation tick picks
    // up tracking from there, the same way it does for a post-creation link.
    const snapshot = await getSendatrackSnapshot(session.credentials);
    const liveVehicle = matchDeliveryVehicle({ sendatrackVehicleId, truck }, snapshot.vehicles).vehicle;
    const originLatitude = originSite?.latitude ?? null;
    const originLongitude = originSite?.longitude ?? null;

    // Only when the resolved destination site has a shortCodePrefix
    // configured -- see the comment on KnownSite.shortCodePrefix for why a
    // site with none set gets no short code at all, rather than a
    // fabricated one.
    const shortCode = site?.shortCodePrefix ? await store.assignShortCode(session.companyId, site.shortCodePrefix) : null;

    let delivery: DeliveryRow;
    try {
      delivery = await store.create({
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
        eta: normalizedEta,
        plannedArrivalAt,
        nextTruckDepartureAt,
        contact,
        customerEmail: customerEmail || null,
        recipientName,
        recipientContact,
        weightKg,
        priceAmount,
        priceCurrency,
        itemDescription: itemDescriptionInput || null,
        whatsappOptIn,
        whatsappOptInAt: whatsappOptIn ? new Date() : null,
        recipientWhatsappOptIn,
        recipientWhatsappOptInAt: recipientWhatsappOptIn ? new Date() : null,
        sendatrackVehicleId: liveVehicle?.id ?? sendatrackVehicleId,
        companyId: session.companyId,
        trackingToken: idempotencyTrackingToken ?? createTrackingToken(),
        shipmentId: shipmentIdInput || null,
        parcelCode: createParcelCode(),
        shortCode,
        paymentStatus: paymentStatusInput as "unpaid" | "partial" | "paid",
        amountPaid,
        driver: "To be assigned", status: "Loading", progress: 0, color: "#916ed7",
        latitude: originLatitude, longitude: originLongitude,
        speed: null, lastPositionAt: null,
        gpsSource: "simulation",
      });
    } catch (error) {
      if (idempotencyTrackingToken) {
        const existing = await store.getPublic(idempotencyTrackingToken).catch(() => null);
        if (existing?.companyId === session.companyId
          && (session.role === "dispatcher" || agencyDeliveryIsVisible(existing, session.siteId))
          && deliveryIdempotencyPayloadMatches(existing, { customer, destination, contact, customerEmail: customerEmail || null, recipientName, recipientContact, eta: normalizedEta, plannedArrivalAt, nextTruckDepartureAt, weightKg, priceAmount, priceCurrency, itemDescription: itemDescriptionInput || null })) {
          return idempotentReplayResponse(existing, session.companyId);
        }
      }
      throw error;
    }
    await store.recordEvent(delivery.id, "REGISTERED", delivery.progress);
    await processPendingNotifications(session.companyId, new URL(request.url).origin);

    const rows = await store.listForCompany(session.companyId);
    const serviceMinutes = pendingServiceMinutesBefore(delivery, rows);
    const newDeliveryManualArrivalEstimate = knownSite(delivery.destinationSiteId)?.finalLegTrackingUnavailable === true
      ? (await getManualArrivalDurationEstimates(session.companyId)).get(delivery.destinationSiteId!) ?? null
      : null;
    const enriched = await enrichAndDetectDelay(delivery, serviceMinutes, null, 0, newDeliveryManualArrivalEstimate);
    return Response.json({ delivery: enriched.delivery, idempotentReplay: false }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

// Dispatcher-only, permanent deletion of one delivery (e.g. an accidental
// or test entry) -- gated behind a confirmation in the UI (see page.tsx).
// Unlike the demo-delivery bulk DELETE, this isn't restricted to any
// customer-name prefix: store.deleteDelivery itself is the safety
// boundary, scoping the removal to a company_id match.
export async function DELETE(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
    if (session.role !== "dispatcher") return Response.json({ error: "dispatcher_only" }, { status: 403, headers: { "cache-control": "no-store" } });

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();
    const deliveryId = String(payload.deliveryId ?? "").trim();
    if (!deliveryId || deliveryId.length > 100) return Response.json({ error: "invalid_delivery_id" }, { status: 400, headers: { "cache-control": "no-store" } });

    const deleted = await store.deleteDelivery(deliveryId, session.companyId);
    if (!deleted) return Response.json({ error: "delivery_not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
    return Response.json({ ok: true, deliveryId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
