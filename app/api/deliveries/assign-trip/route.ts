import { store } from "trackfleet-delivery-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";
import { validatePlannedTripAssignment } from "../../../lib/trip-assignment";

const errorStatus = {
  delivery_not_unassigned: 409,
  trip_not_planned: 409,
  origin_mismatch: 409,
  destination_not_on_trip: 409,
} as const;

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  const tripId = String(payload.tripId ?? "").trim();
  if (!deliveryId || !tripId || deliveryId.length > 100 || tripId.length > 100) {
    return Response.json({ error: "invalid_delivery_or_trip_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const [trip, deliveries] = await Promise.all([store.getTrip(session.companyId, tripId), store.listForCompany(session.companyId)]);
  if (!trip) return Response.json({ error: "trip_not_found" }, { status: 404 });
  const delivery = deliveries.find((item) => item.id === deliveryId) ?? null;
  if (!delivery) return Response.json({ error: "delivery_not_found" }, { status: 404 });

  const validationError = validatePlannedTripAssignment(delivery, trip);
  if (validationError) return Response.json({ error: validationError }, { status: errorStatus[validationError] });

  const updated = await store.assignDeliveryToPlannedTrip(delivery.id, session.companyId, trip.id, trip.truck, trip.sendatrackVehicleId);
  if (!updated) return Response.json({ error: "assignment_conflict" }, { status: 409 });
  return Response.json({ delivery: updated, trip: { id: trip.id, routeTemplateId: trip.routeTemplateId, truck: trip.truck } }, { headers: { "cache-control": "no-store" } });
}
