import { store } from "trackfleet-delivery-store";
import { calculateRouteMetrics } from "../../lib/route-progress";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
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
}>(row: T) {
  const metrics = typeof row.latitude === "number" && typeof row.longitude === "number"
    ? calculateRouteMetrics(row.latitude, row.longitude, row.destination)
    : null;
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

export async function GET(request: Request) {
  try {
    const tracking = new URL(request.url).searchParams.get("tracking")?.trim();
    if (tracking) {
      let row = await store.getPublic(tracking);
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

      // Public tracking has no company login cookie. For the current single-account
      // deployment, refresh from server-side SENDATRACK credentials when available
      // so the customer's link does not depend on an operator keeping the dashboard open.
      const integration = await getSendatrackSnapshot();
      if (integration.connected) {
        await store.applySendatrackSnapshot(integration, row.companyId);
        row = await store.getPublic(tracking) ?? row;
      }

      return Response.json({ deliveries: [enrichDelivery(row)], publicTracking: true }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const integration = await getSendatrackSnapshot(session.credentials);
    await store.applySendatrackSnapshot(integration, session.companyId);
    const rows = await store.listForCompany(session.companyId);

    return Response.json({
      deliveries: rows.map(enrichDelivery),
      integration: {
        configured: integration.configured,
        connected: integration.connected,
        vehicleCount: integration.vehicles.length,
        error: integration.error ?? null,
        vehicles: integration.vehicles.map((vehicle) => ({
          id: vehicle.id,
          name: vehicle.name,
          speed: vehicle.speed,
          updatedAt: vehicle.updatedAt,
          latitude: vehicle.latitude,
          longitude: vehicle.longitude,
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

    const delivery = await store.create({
      customer,
      destination,
      truck,
      eta,
      contact: String(payload.contact ?? "").trim(),
      sendatrackVehicleId,
      companyId: session.companyId,
      trackingToken: createTrackingToken(),
      driver: "To be assigned",
      status: "Loading",
      progress: 0,
      color: "#916ed7",
      latitude: null,
      longitude: null,
      speed: null,
      lastPositionAt: null,
      gpsSource: "simulation",
    });

    return Response.json({ delivery: enrichDelivery(delivery) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
