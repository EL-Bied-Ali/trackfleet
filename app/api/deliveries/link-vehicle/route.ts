import { store } from "trackfleet-delivery-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";
import { getSendatrackSnapshot } from "../../../lib/sendatrack";
import { applyVehicleAliases } from "../../../lib/vehicle-alias-apply";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  // A group of parcels riding the same physical truck can be reassigned
  // together via deliveryIds -- linkVehicle's own "unassign this vehicle
  // from any OTHER delivery that currently holds it" safety guard only
  // excludes the one delivery being linked, so looping the single-id path
  // once per parcel in a group would have each call strip the vehicle right
  // back off the parcel(s) the previous call(s) just assigned it to. See
  // linkVehicleToGroup in delivery-store.types.ts.
  const bulk = Array.isArray(payload.deliveryIds);
  const deliveryId = String(payload.deliveryId ?? "").trim();
  const deliveryIds = bulk ? (payload.deliveryIds as unknown[]).map((id) => String(id).trim()).filter(Boolean) : [];
  const vehicleId = String(payload.vehicleId ?? "").trim();
  if (!vehicleId || vehicleId.length > 160) {
    return Response.json({ error: "invalid_delivery_or_vehicle_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (bulk) {
    if (!deliveryIds.length || deliveryIds.length > 50 || deliveryIds.some((id) => id.length > 100)) {
      return Response.json({ error: "invalid_delivery_or_vehicle_id" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
  } else if (!deliveryId || deliveryId.length > 100) {
    return Response.json({ error: "invalid_delivery_or_vehicle_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const deliveries = await store.listForCompany(session.companyId);
  if (bulk) {
    if (!deliveryIds.every((id) => deliveries.some((item) => item.id === id))) {
      return Response.json({ error: "delivery_not_found" }, { status: 404 });
    }
  } else if (!deliveries.some((item) => item.id === deliveryId)) {
    return Response.json({ error: "delivery_not_found" }, { status: 404 });
  }
  // Previously required an unassigned delivery to go through the planned-trip
  // system first (assign-trip). Truck assignment moved out of the creation
  // form entirely (see page.tsx) in favor of assigning/reassigning any
  // delivery -- unassigned or not -- directly from the delivery table, so
  // this endpoint now handles both the initial assignment and later
  // reassignment the same way.
  const rawSnapshot = await getSendatrackSnapshot(session.credentials);
  if (!rawSnapshot.connected) return Response.json({ error: "sendatrack_unavailable" }, { status: 503 });
  // See vehicle-alias-apply.ts -- without this, a renamed truck reverted to
  // its raw SENDATRACK name the instant it actually got assigned.
  const snapshot = await applyVehicleAliases(rawSnapshot, session.companyId);
  const vehicle = snapshot.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return Response.json({ error: "vehicle_not_found" }, { status: 404 });

  if (bulk) {
    const updated = await store.linkVehicleToGroup(deliveryIds, session.companyId, vehicle);
    if (!updated.length) return Response.json({ error: "delivery_not_found_or_not_linkable" }, { status: 404 });
    return Response.json({ deliveries: updated }, { headers: { "cache-control": "no-store" } });
  }
  const delivery = await store.linkVehicle(deliveryId, session.companyId, vehicle);
  if (!delivery) return Response.json({ error: "delivery_not_found_or_not_linkable" }, { status: 404 });
  return Response.json({ delivery }, { headers: { "cache-control": "no-store" } });
}
