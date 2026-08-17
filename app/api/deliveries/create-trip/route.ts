import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { getSendatrackSnapshot } from "../../../lib/sendatrack";
import { firstStopRouteTemplateId, manualTripVehicleKey, validateNewPlannedTrip } from "../../../lib/planned-trip-creation";

export async function POST(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  const payload = await request.json() as Record<string, unknown>;
  const deliveryId = String(payload.deliveryId ?? "").trim();
  const vehicleId = String(payload.vehicleId ?? "").trim();
  const manualTruck = String(payload.manualTruck ?? "").trim();
  if (!deliveryId) return Response.json({ error: "deliveryId is required" }, { status: 400 });

  const deliveries = await store.listForCompany(session.companyId);
  const delivery = deliveries.find((item) => item.id === deliveryId) ?? null;
  if (!delivery) return Response.json({ error: "delivery_not_found" }, { status: 404 });

  let truck = manualTruck;
  let sendatrackVehicleId = "";
  let vehicleKey = manualTripVehicleKey(manualTruck);
  if (vehicleId) {
    const snapshot = await getSendatrackSnapshot(session.credentials);
    if (!snapshot.connected) return Response.json({ error: "sendatrack_unavailable" }, { status: 503 });
    const vehicle = snapshot.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return Response.json({ error: "vehicle_not_found" }, { status: 404 });
    truck = vehicle.name;
    sendatrackVehicleId = vehicle.id;
    vehicleKey = vehicle.id;
  }

  const validationError = validateNewPlannedTrip(delivery, truck);
  if (validationError) return Response.json({ error: validationError }, { status: 409 });
  const tripId = `TRIP-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const trip = await store.upsertTrip({
    id: tripId, companyId: session.companyId, routeTemplateId: firstStopRouteTemplateId(delivery), vehicleKey, truck, sendatrackVehicleId,
    originSiteId: delivery.originSiteId,
    stops: [{ siteId: delivery.destinationSiteId!, destination: delivery.destination, sequence: 1, plannedArrivalAt: delivery.plannedArrivalAt }],
    status: "planned",
  });
  const updated = await store.assignDeliveryToPlannedTrip(delivery.id, session.companyId, trip.id, trip.truck, trip.sendatrackVehicleId);
  if (!updated) return Response.json({ error: "assignment_conflict" }, { status: 409 });
  return Response.json({ delivery: updated, trip });
}
