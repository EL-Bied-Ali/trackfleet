import { getSendatrackSnapshot, type SendatrackSnapshot } from "../../lib/sendatrack";
import { createTrackingToken, getCompanySession } from "../../lib/company-auth";

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";

type DeliveryRow = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  progress: number;
  color: string;
  contact: string;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: Date | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  createdAt: Date;
};

const seedDeliveries: DeliveryRow[] = [
  { id: "TF-2841", customer: "Atlas Home", destination: "Casablanca, MA", truck: "TRK-014", driver: "Youssef B.", status: "In transit", eta: "19 Aug · 14:00–18:00", progress: 68, color: "#16a272", contact: "", sendatrackVehicleId: "", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "demo", trackingToken: null, createdAt: new Date("2026-08-14T08:42:00Z") },
  { id: "TF-2839", customer: "Medina Import", destination: "Tangier, MA", truck: "TRK-007", driver: "Sophie L.", status: "Delayed", eta: "20 Aug · 09:00–13:00", progress: 55, color: "#f1a43c", contact: "", sendatrackVehicleId: "", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "demo", trackingToken: null, createdAt: new Date("2026-08-14T08:35:00Z") },
  { id: "TF-2837", customer: "Brussels Parts", destination: "Brussels, BE", truck: "TRK-019", driver: "Amine R.", status: "In transit", eta: "18 Aug · 16:00–20:00", progress: 82, color: "#4776e6", contact: "", sendatrackVehicleId: "", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "demo", trackingToken: null, createdAt: new Date("2026-08-14T08:22:00Z") },
  { id: "TF-2835", customer: "Rif Logistics", destination: "Antwerp, BE", truck: "TRK-003", driver: "Nora V.", status: "Loading", eta: "21 Aug · 10:00–14:00", progress: 8, color: "#916ed7", contact: "", sendatrackVehicleId: "", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "demo", trackingToken: null, createdAt: new Date("2026-08-14T08:10:00Z") },
  { id: "TF-2832", customer: "EuroMaghreb", destination: "Liège, BE", truck: "TRK-011", driver: "Marc D.", status: "Delivered", eta: "17 Aug · 17:32", progress: 100, color: "#6b7280", contact: "", sendatrackVehicleId: "", latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "demo", trackingToken: null, createdAt: new Date("2026-08-14T07:50:00Z") },
];

const deliveryStore = [...seedDeliveries];

function key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
  if (!snapshot.connected || !snapshot.vehicles.length) return;
  for (const delivery of deliveryStore) {
    if (delivery.status === "Delivered" || (delivery.companyId !== companyId && delivery.companyId !== "demo")) continue;
    const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId)
      ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
    if (!vehicle) continue;
    delivery.sendatrackVehicleId = vehicle.id;
    delivery.truck = vehicle.name;
    delivery.latitude = vehicle.latitude;
    delivery.longitude = vehicle.longitude;
    delivery.speed = vehicle.speed;
    delivery.lastPositionAt = new Date(vehicle.updatedAt);
    delivery.gpsSource = "sendatrack";
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const tracking = new URL(request.url).searchParams.get("tracking")?.trim();
    if (tracking) {
      const row = deliveryStore.find((delivery) =>
        delivery.trackingToken === tracking || (delivery.companyId === "demo" && delivery.id === tracking));
      if (!row) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
      return Response.json({ deliveries: [row], publicTracking: true }, { headers: { "cache-control": "no-store" } });
    }

    const session = await getCompanySession(request);
    if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
    const integration = await getSendatrackSnapshot(session.credentials);
    applySendatrackSnapshot(integration, session.companyId);
    const rows = deliveryStore
      .filter((delivery) => delivery.companyId === session.companyId || delivery.companyId === "demo")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Response.json({
      deliveries: rows,
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
    const destination = String(payload.destination ?? "").trim();
    const truck = String(payload.truck ?? "").trim();
    const sendatrackVehicleId = String(payload.sendatrackVehicleId ?? "").trim();
    const eta = String(payload.eta ?? "").trim();

    if (!customer || !destination || !truck || !/^\d{2}:\d{2}$/.test(eta)) {
      return Response.json({ error: "customer, destination, truck, and a valid ETA are required" }, { status: 400 });
    }

    const delivery: DeliveryRow = {
      id: `TF-${String(Date.now()).slice(-6)}`,
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
      createdAt: new Date(),
    };
    deliveryStore.push(delivery);

    return Response.json({ delivery }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
