import { store } from "trackfleet-delivery-store";
import type { DeliveryTransition } from "../../lib/delivery-store.types";
import { shouldDetectDelay } from "../../lib/delay-detection";
import { customerFacingEvent } from "../../lib/delivery-events";
import { estimateArrival } from "../../lib/eta-estimator";
import { resolveKnownSite } from "../../lib/known-sites";
import { processPendingNotifications } from "../../lib/notification-runner";
import { calculateRouteMetrics, rebaseRouteMetrics } from "../../lib/route-progress";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";
import { publicTrackingIsActive, trackingExpiresAt } from "../../lib/tracking-access";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

function explicitDestination(row: { destinationLatitude?: number | null; destinationLongitude?: number | null }): [number, number] | null {
  return typeof row.destinationLatitude === "number" && typeof row.destinationLongitude === "number"
    ? [row.destinationLongitude, row.destinationLatitude]
    : null;
}

function enrichDelivery<T extends {
  latitude: number | null;
  longitude: number | null;
  destination: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  lastPositionAt: Date | null;
  plannedArrivalAt?: Date | null;
  status?: string;
}>(
  row: T,
  events: Awaited<ReturnType<typeof store.listEvents>> = [],
) {
  const baselineProgress = events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0;
  const absoluteMetrics = typeof row.latitude === "number" && typeof row.longitude === "number"
    ? calculateRouteMetrics(row.latitude, row.longitude, row.destination, explicitDestination(row))
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
    trackingExpiresAt: "createdAt" in row && row.createdAt instanceof Date ? trackingExpiresAt({ plannedArrivalAt: row.plannedArrivalAt ?? null, createdAt: row.createdAt }).toISOString() : null,
  };
}

async function enrichAndDetectDelay<T extends {
  id: string;
  progress: number;
  latitude: number | null;
  longitude: number | null;
  destination: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  lastPositionAt: Date | null;
  plannedArrivalAt?: Date | null;
  status: string;
}>(row: T) {
  let events = await store.listEvents(row.id);
  let delivery = enrichDelivery(row, events);
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
    delivery = enrichDelivery(row, events);
  }

  return { delivery, events };
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      let row = await store.getPublic(tracking);
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      if (!publicTrackingIsActive(row)) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      const integration = await getSendatrackSnapshot();
      if (integration.connected) {
        const transitions = await store.applySendatrackSnapshot(integration, row.companyId);
        await persistTransitionEvents(transitions);
        row = await store.getPublic(tracking) ?? row;
      }

      const enriched = await enrichAndDetectDelay(row);
      await processPendingNotifications(row.companyId, requestUrl.origin);
      return Response.json({
        deliveries: [enriched.delivery],
        events: enriched.events.filter((event) => customerFacingEvent(event.type)),
        publicTracking: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const integration = await getSendatrackSnapshot(session.credentials);
    const transitions = await store.applySendatrackSnapshot(integration, session.companyId);
    await persistTransitionEvents(transitions);
    const rows = await store.listForCompany(session.companyId);
    const enrichedRows = await Promise.all(rows.map(async (row) => (await enrichAndDetectDelay(row)).delivery));
    await processPendingNotifications(session.companyId, requestUrl.origin);

    return Response.json({
      deliveries: enrichedRows,
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
    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

    const payload = (await request.json()) as Record<string, unknown>;
    const customer = String(payload.customer ?? "").trim();
    const destinationInput = String(payload.destination ?? "").trim();
    const destinationSiteId = String(payload.destinationSiteId ?? "").trim();
    const site = resolveKnownSite(destinationSiteId) ?? resolveKnownSite(destinationInput);
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
    const liveVehicle = snapshot.vehicles.find((vehicle) => vehicle.id === sendatrackVehicleId)
      ?? snapshot.vehicles.find((vehicle) => vehicle.name === truck);
    const baselineMetrics = liveVehicle
      ? calculateRouteMetrics(liveVehicle.latitude, liveVehicle.longitude, destination, exactDestination)
      : null;

    const delivery = await store.create({
      customer,
      destination,
      destinationLatitude,
      destinationLongitude,
      arrivalRadiusKm,
      truck: liveVehicle?.name ?? truck,
      eta: validLegacyEta ? eta : plannedArrivalAt!.toISOString().slice(11, 16),
      plannedArrivalAt,
      contact: String(payload.contact ?? "").trim(),
      sendatrackVehicleId: liveVehicle?.id ?? sendatrackVehicleId,
      companyId: session.companyId,
      trackingToken: createTrackingToken(),
      driver: "To be assigned", status: "Loading", progress: 0, color: "#916ed7",
      latitude: liveVehicle?.latitude ?? null, longitude: liveVehicle?.longitude ?? null,
      speed: liveVehicle?.speed ?? null, lastPositionAt: liveVehicle ? new Date(liveVehicle.updatedAt) : null,
      gpsSource: liveVehicle ? "sendatrack" : "simulation",
    });
    if (baselineMetrics) await store.recordEvent(delivery.id, "GPS_BASELINE", baselineMetrics.progress);

    const enriched = await enrichAndDetectDelay(delivery);
    return Response.json({ delivery: enriched.delivery }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
