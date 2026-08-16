import { store } from "trackfleet-delivery-store";
import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const tracking = new URL(request.url).searchParams.get("tracking")?.trim();
    if (tracking) {
      const row = await store.getPublic(tracking);
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
      return Response.json({ deliveries: [row], publicTracking: true }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

    const integration = await getSendatrackSnapshot(session.credentials);
    await store.applySendatrackSnapshot(integration, session.companyId);
    const rows = await store.listForCompany(session.companyId);

    return Response.json({
      deliveries: rows,
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
      progress: 8,
      color: "#916ed7",
      latitude: null,
      longitude: null,
      speed: null,
      lastPositionAt: null,
      gpsSource: "simulation",
    });

    return Response.json({ delivery }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
