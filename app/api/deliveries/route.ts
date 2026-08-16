import { store } from "trackfleet-delivery-store";
import type { DeliveryTransition } from "../../lib/delivery-store.types";
import { customerFacingEvent } from "../../lib/delivery-events";
import { calculateRouteMetrics, rebaseRouteMetrics } from "../../lib/route-progress";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { sendAutomaticWhatsAppNotification } from "../../lib/whatsapp-automation";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

function enrichDelivery<T extends {
  latitude: number | null;
  longitude: number | null;
  destination: string;
  lastPositionAt: Date | null;
}>(row: T, baselineProgress = 0) {
  const absoluteMetrics = typeof row.latitude === "number" && typeof row.longitude === "number"
    ? calculateRouteMetrics(row.latitude, row.longitude, row.destination)
    : null;
  const metrics = absoluteMetrics ? rebaseRouteMetrics(absoluteMetrics, baselineProgress) : null;
  const positionAgeMinutes = row.lastPositionAt
    ? Math.max(0, Math.round((Date.now() - row.lastPositionAt.getTime()) / 60_000))
    : null;
  return {
    ...row,
    routeDistanceKm: metrics ? Math.round(metrics.routeDistanceKm) : null,
    remainingDistanceKm: metrics ? Math.round(metrics.remainingDistanceKm) : null,
    distanceToDestinationKm: metrics ? Math.round(metrics.distanceToDestinationKm) : null,
    positionAgeMinutes,
    gpsFresh: positionAgeMinutes !== null && positionAgeMinutes <= 30,
  };
}

function baselineFromEvents(events: Awaited<ReturnType<typeof store.listEvents>>) {
  return events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0;
}

async function persistTransitionEvents(transitions: DeliveryTransition[], origin: string) {
  for (const transition of transitions) {
    for (const type of transition.events) {
      const isNew = await store.recordEvent(transition.delivery.id, type, transition.delivery.progress);
      if (!isNew) continue;
      const trackingUrl = new URL(origin);
      trackingUrl.searchParams.set("tracking", transition.delivery.trackingToken || transition.delivery.id);
      await sendAutomaticWhatsAppNotification(type, transition.delivery, trackingUrl.toString());
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

      const integration = await getSendatrackSnapshot();
      if (integration.connected) {
        const transitions = await store.applySendatrackSnapshot(integration, row.companyId);
        await persistTransitionEvents(transitions, requestUrl.origin);
        row = await store.getPublic(tracking) ?? row;
      }

      const allEvents = await store.listEvents(row.id);
      return Response.json({
        deliveries: [enrichDelivery(row, baselineFromEvents(allEvents))],
        events: allEvents.filter((event) => customerFacingEvent(event.type)),
        publicTracking: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const integration = await getSendatrackSnapshot(session.credentials);
    const transitions = await store.applySendatrackSnapshot(integration, session.companyId);
    await persistTransitionEvents(transitions, requestUrl.origin);
    const rows = await store.listForCompany(session.companyId);
    const enrichedRows = await Promise.all(rows.map(async (row) => {
      const events = await store.listEvents(row.id);
      return enrichDelivery(row, baselineFromEvents(events));
    }));

    return Response.json({
      deliveries: enrichedRows,
      integration: {
        configured: integration.configured,
        connected: integration.connected,
        vehicleCount: integration.vehicles.length,
        error: integration.error ?? null,
        vehicles: integration.vehicles.map((vehicle) => ({
          id: vehicle.id, name: vehicle.name, speed: vehicle.speed, updatedAt: vehicle.updatedAt,
          latitude: vehicle.latitude, longitude: vehicle.longitude,
        })),
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
    const destination = String(payload.destination ?? "").trim();
    const truck = String(payload.truck ?? "").trim();
    const sendatrackVehicleId = String(payload.sendatrackVehicleId ?? "").trim();
    const eta = String(payload.eta ?? "").trim();

    if (!customer || !destination || !truck || !/^\d{2}:\d{2}$/.test(eta)) {
      return Response.json({ error: "customer, destination, truck, and a valid ETA are required" }, { status: 400 });
    }

    // Capture the selected truck's actual GPS fix at creation. That absolute
    // corridor position becomes the 0% baseline for this delivery.
    const snapshot = await getSendatrackSnapshot(session.credentials);
    const liveVehicle = snapshot.vehicles.find((vehicle) => vehicle.id === sendatrackVehicleId)
      ?? snapshot.vehicles.find((vehicle) => vehicle.name === truck);
    const baselineMetrics = liveVehicle
      ? calculateRouteMetrics(liveVehicle.latitude, liveVehicle.longitude, destination)
      : null;

    const delivery = await store.create({
      customer,
      destination,
      truck: liveVehicle?.name ?? truck,
      eta,
      contact: String(payload.contact ?? "").trim(),
      sendatrackVehicleId: liveVehicle?.id ?? sendatrackVehicleId,
      companyId: session.companyId,
      trackingToken: createTrackingToken(),
      driver: "To be assigned",
      status: "Loading",
      progress: 0,
      color: "#916ed7",
      latitude: liveVehicle?.latitude ?? null,
      longitude: liveVehicle?.longitude ?? null,
      speed: liveVehicle?.speed ?? null,
      lastPositionAt: liveVehicle ? new Date(liveVehicle.updatedAt) : null,
      gpsSource: liveVehicle ? "sendatrack" : "simulation",
    });

    if (baselineMetrics) {
      await store.recordEvent(delivery.id, "GPS_BASELINE", baselineMetrics.progress);
    }

    return Response.json({
      delivery: enrichDelivery(delivery, baselineMetrics?.progress ?? 0),
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
