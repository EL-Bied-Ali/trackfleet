import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { getSendatrackSnapshot } from "../../../lib/sendatrack";

export async function POST(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

  const payload = await request.json() as Record<string, unknown>;
  const deliveryId = String(payload.deliveryId ?? "").trim();
  const vehicleId = String(payload.vehicleId ?? "").trim();
  if (!deliveryId || !vehicleId) return Response.json({ error: "deliveryId and vehicleId are required" }, { status: 400 });

  const snapshot = await getSendatrackSnapshot(session.credentials);
  if (!snapshot.connected) return Response.json({ error: "sendatrack_unavailable" }, { status: 503 });
  const vehicle = snapshot.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return Response.json({ error: "vehicle_not_found" }, { status: 404 });

  const delivery = await store.linkVehicle(deliveryId, session.companyId, vehicle);
  if (!delivery) return Response.json({ error: "delivery_not_found_or_not_linkable" }, { status: 404 });
  return Response.json({ delivery });
}
