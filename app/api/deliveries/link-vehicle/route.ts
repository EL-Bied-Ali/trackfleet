import { store } from "trackfleet-delivery-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";
import { getSendatrackSnapshot } from "../../../lib/sendatrack";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  const vehicleId = String(payload.vehicleId ?? "").trim();
  if (!deliveryId || !vehicleId || deliveryId.length > 100 || vehicleId.length > 160) {
    return Response.json({ error: "invalid_delivery_or_vehicle_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const deliveries = await store.listForCompany(session.companyId);
  const existingDelivery = deliveries.find((item) => item.id === deliveryId) ?? null;
  if (!existingDelivery) return Response.json({ error: "delivery_not_found" }, { status: 404 });
  // Previously required an unassigned delivery to go through the planned-trip
  // system first (assign-trip). Truck assignment moved out of the creation
  // form entirely (see page.tsx) in favor of assigning/reassigning any
  // delivery -- unassigned or not -- directly from the delivery table, so
  // this endpoint now handles both the initial assignment and later
  // reassignment the same way.
  const snapshot = await getSendatrackSnapshot(session.credentials);
  if (!snapshot.connected) return Response.json({ error: "sendatrack_unavailable" }, { status: 503 });
  const vehicle = snapshot.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return Response.json({ error: "vehicle_not_found" }, { status: 404 });

  const delivery = await store.linkVehicle(deliveryId, session.companyId, vehicle);
  if (!delivery) return Response.json({ error: "delivery_not_found_or_not_linkable" }, { status: 404 });
  return Response.json({ delivery }, { headers: { "cache-control": "no-store" } });
}
