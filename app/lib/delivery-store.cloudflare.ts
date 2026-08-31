import { runtimeEnv } from "trackfleet-runtime-env";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import { createDeliveryId } from "./delivery-id";
import { progressRouteDestination } from "./delivery-progress-destination";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryStatus, DeliveryTransition, EtaObservationRow } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";
import { matchDeliveryVehicle } from "./vehicle-linking";
import { UNASSIGNED_TRUCK } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "./demo-delivery";

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return runtimeEnv.DB;
}

type RawDelivery = {
  id: string; customer: string; originSiteId: string | null; originLatitude: number | null; originLongitude: number | null; destinationSiteId: string | null; destination: string;
  destinationLatitude: number | null; destinationLongitude: number | null; arrivalRadiusKm: number | null;
  truck: string; driver: string; status: DeliveryStatus; eta: string; plannedArrivalAt: number | null; nextTruckDepartureAt: number | null;
  progress: number; color: string; contact: string; recipientName: string | null; recipientContact: string | null; weightKg: number | null; priceAmount: number | null; priceCurrency: "EUR" | "MAD" | null; itemDescription: string | null; customerEmail: string | null; whatsappOptIn: number | null; whatsappOptInAt: number | null; recipientWhatsappOptIn: number | null; recipientWhatsappOptInAt: number | null;
  sendatrackVehicleId: string; latitude: number | null; longitude: number | null; speed: number | null;
  lastPositionAt: number | null; gpsSource: string; companyId: string; trackingToken: string | null; tripId: string | null; shipmentId: string | null; createdAt: number;
};
type RawDeliveryEvent = { deliveryId: string; type: DeliveryEventType; progress: number; createdAt: number };
function hydrate(row: RawDelivery): DeliveryRow {
  return {
    ...row,
    originSiteId: row.originSiteId ?? null,
    originLatitude: row.originLatitude ?? null,
    originLongitude: row.originLongitude ?? null,
    destinationSiteId: row.destinationSiteId ?? null,
    destinationLatitude: row.destinationLatitude ?? null,
    destinationLongitude: row.destinationLongitude ?? null,
    arrivalRadiusKm: row.arrivalRadiusKm ?? 0.5,
    weightKg: row.weightKg ?? null,
    priceAmount: row.priceAmount ?? null,
    priceCurrency: row.priceCurrency === "EUR" || row.priceCurrency === "MAD" ? row.priceCurrency : null,
    itemDescription: row.itemDescription ?? null,
    customerEmail: row.customerEmail ?? null,
    recipientName: row.recipientName ?? "",
    recipientContact: row.recipientContact ?? "",
    plannedArrivalAt: row.plannedArrivalAt ? new Date(row.plannedArrivalAt) : null,
    nextTruckDepartureAt: row.nextTruckDepartureAt ? new Date(row.nextTruckDepartureAt) : null,
    whatsappOptIn: row.whatsappOptIn === 1,
    whatsappOptInAt: row.whatsappOptInAt ? new Date(row.whatsappOptInAt) : null,
    recipientWhatsappOptIn: row.recipientWhatsappOptIn === 1,
    recipientWhatsappOptInAt: row.recipientWhatsappOptInAt ? new Date(row.recipientWhatsappOptInAt) : null,
    lastPositionAt: row.lastPositionAt ? new Date(row.lastPositionAt) : null,
    createdAt: new Date(row.createdAt),
  };
}
function hydrateEvent(row: RawDeliveryEvent): DeliveryEventRow { return { ...row, createdAt: new Date(row.createdAt) }; }
function explicitDestination(delivery: DeliveryRow): [number, number] | null {
  return typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
    ? [delivery.destinationLongitude, delivery.destinationLatitude]
    : null;
}
function explicitOrigin(delivery: DeliveryRow): [number, number] | null {
  return typeof delivery.originLatitude === "number" && typeof delivery.originLongitude === "number"
    ? [delivery.originLongitude, delivery.originLatitude]
    : null;
}

const selectColumns = `id, customer, origin_site_id AS originSiteId, origin_latitude AS originLatitude, origin_longitude AS originLongitude, destination_site_id AS destinationSiteId, destination,
  destination_latitude AS destinationLatitude, destination_longitude AS destinationLongitude, arrival_radius_km AS arrivalRadiusKm,
  truck, driver, status, eta, planned_arrival_at AS plannedArrivalAt, next_truck_departure_at AS nextTruckDepartureAt, progress, color, contact, recipient_name AS recipientName, recipient_contact AS recipientContact,
  weight_kg AS weightKg, price_amount AS priceAmount, price_currency AS priceCurrency, item_description AS itemDescription, customer_email AS customerEmail,
  whatsapp_opt_in AS whatsappOptIn, whatsapp_opt_in_at AS whatsappOptInAt,
  recipient_whatsapp_opt_in AS recipientWhatsappOptIn, recipient_whatsapp_opt_in_at AS recipientWhatsappOptInAt,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, trip_id AS tripId, shipment_id AS shipmentId, created_at AS createdAt`;

async function baselineProgress(deliveryId: string) {
  const row = await db().prepare("SELECT progress FROM delivery_events WHERE delivery_id = ? AND type = 'GPS_BASELINE' LIMIT 1").bind(deliveryId).first<{ progress: number }>();
  return row?.progress ?? 0;
}

export const store: DeliveryStore = {
  async getPublic(tracking) {
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE tracking_token = ? LIMIT 1`).bind(tracking).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },
  async listForCompany(companyId) {
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE company_id = ? ORDER BY created_at DESC`).bind(companyId).all<RawDelivery>();
    return (result.results ?? []).map(hydrate);
  },
  async findMostRecentActiveDeliveryByContact(phone) {
    // Either party texting in gets matched -- the sender tracking what they
    // shipped and the recipient tracking what's coming to them are both
    // legitimate, per the user's explicit call.
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE (contact = ? OR recipient_contact = ?) AND status != 'Delivered' ORDER BY created_at DESC LIMIT 1`).bind(phone, phone).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },
  async findMostRecentActiveDeliveryByCustomerNameQuery(query) {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE status != 'Delivered' AND customer LIKE ? ORDER BY created_at DESC LIMIT 1`).bind(`%${trimmed}%`).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },
  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE company_id = ? AND status != 'Delivered'`).bind(companyId).all<RawDelivery>();
    const statements = [];
    for (const rawDelivery of result.results ?? []) {
      const delivery = hydrate(rawDelivery);
      const match = matchDeliveryVehicle(delivery, snapshot.vehicles);
      const vehicle = match.vehicle;
      if (!vehicle) continue;
      const firstLink = delivery.gpsSource !== "sendatrack";
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const origin = explicitOrigin(delivery);
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, origin);
      if (firstLink) statements.push(db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'GPS_BASELINE', ?, ?)`).bind(delivery.id, absoluteMetrics.progress, Date.now()));
      const metrics = rebaseRouteMetrics(absoluteMetrics, origin ? 0 : (firstLink ? absoluteMetrics.progress : await baselineProgress(delivery.id)));
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const state = firstLink ? { status: "Loading" as const, progress: previousProgress } : deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress, delivery.arrivalRadiusKm, positionAgeMinutes);
      const events = firstLink ? [] : detectDeliveryEvents({ previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes });
      statements.push(db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', progress = ?, status = ? WHERE id = ?`).bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, state.progress, state.status, delivery.id));
      transitions.push({ delivery: { ...delivery, sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", progress: state.progress, status: state.status }, events });
    }
    if (statements.length) await db().batch(statements);
    return transitions;
  },
  async linkVehicle(deliveryId, companyId, vehicle) {
    const raw = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    if (!raw) return null;
    const delivery = hydrate(raw);
    const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
    const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to be the first statement here). One truck
    // legitimately carrying several parcels at once is the group feature's
    // whole premise -- this single-delivery path is now just
    // linkVehicleToGroup with one member, so it must not evict the truck's
    // existing group the way it used to. Reported live: adding one more
    // unassigned parcel to an already-multi-parcel truck via this per-row
    // action silently kicked its existing members back to unassigned (stale
    // GPS position/status still attached -- a ghost truck on the map) every
    // time. vehicleAssignmentConflict in page.tsx still warns the dispatcher
    // the truck is in use; trusting that warning (not blocking) was already
    // the design, this just stopped corrupting data when they proceed.
    const statements = [
      db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'GPS_BASELINE', ?, ?)`).bind(delivery.id, metrics.progress, Date.now()),
      db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', status = 'Loading' WHERE id = ? AND company_id = ?`).bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, delivery.id, companyId),
    ];
    // A trip groups deliveries that share one truck's route (see
    // buildTruckStopPlans in truck-stop-plan.ts, keyed by trip_id when
    // present). Moving this delivery onto a genuinely different truck means
    // it's no longer on that route, so it must leave the trip -- otherwise
    // the trip's own truck/vehicleKey record can end up describing a truck
    // that isn't actually what this delivery is on. Re-linking the same
    // vehicle it already has (a no-op reassignment) leaves the trip intact.
    if (delivery.sendatrackVehicleId !== vehicle.id) {
      statements.push(db().prepare(`UPDATE deliveries SET trip_id = NULL WHERE id = ? AND company_id = ?`).bind(delivery.id, companyId));
    }
    await db().batch(statements);
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(delivery.id, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async linkVehicleToGroup(deliveryIds, companyId, vehicle) {
    if (!deliveryIds.length) return [];
    const idPlaceholders = deliveryIds.map(() => "?").join(",");
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id IN (${idPlaceholders}) AND company_id = ? AND status != 'Delivered'`).bind(...deliveryIds, companyId).all<RawDelivery>();
    const deliveries = (result.results ?? []).map(hydrate);
    if (!deliveries.length) return [];
    const matchedIds = deliveries.map((delivery) => delivery.id);
    const matchedPlaceholders = matchedIds.map(() => "?").join(",");
    const statements = deliveries.map((delivery) => {
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
      return db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'GPS_BASELINE', ?, ?)`).bind(delivery.id, metrics.progress, Date.now());
    });
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to run unconditionally here). One truck legitimately
    // carrying several parcels at once is the group feature's whole premise --
    // this must not evict the target truck's existing group the same way
    // linkVehicle used to (see that fix). Reassigning group A onto a truck
    // that already carries group B would otherwise silently kick B back to
    // unassigned, with its last GPS position/status still attached.
    statements.push(db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', status = 'Loading' WHERE id IN (${matchedPlaceholders}) AND company_id = ?`).bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, ...matchedIds, companyId));
    const changingVehicleIds = deliveries.filter((delivery) => delivery.sendatrackVehicleId !== vehicle.id).map((delivery) => delivery.id);
    if (changingVehicleIds.length) {
      const changingPlaceholders = changingVehicleIds.map(() => "?").join(",");
      statements.push(db().prepare(`UPDATE deliveries SET trip_id = NULL WHERE id IN (${changingPlaceholders}) AND company_id = ?`).bind(...changingVehicleIds, companyId));
    }
    await db().batch(statements);
    const updatedResult = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id IN (${matchedPlaceholders}) AND company_id = ?`).bind(...matchedIds, companyId).all<RawDelivery>();
    return (updatedResult.results ?? []).map(hydrate);
  },
  async updateSchedule(deliveryId, companyId, input) {
    const raw = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    if (!raw) return null;
    await db().prepare(`UPDATE deliveries SET planned_arrival_at = ?, next_truck_departure_at = ? WHERE id = ? AND company_id = ?`)
      .bind(input.plannedArrivalAt?.getTime() ?? null, input.nextTruckDepartureAt?.getTime() ?? null, deliveryId, companyId).run();
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async updateDetails(deliveryId, companyId, input) {
    const raw = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    if (!raw) return null;
    await db().prepare(`UPDATE deliveries SET
      customer = ?, contact = ?, customer_email = ?, recipient_name = ?, recipient_contact = ?,
      weight_kg = ?, price_amount = ?, price_currency = ?, item_description = ?, destination_site_id = ?, destination = ?,
      destination_latitude = ?, destination_longitude = ?, arrival_radius_km = ?, planned_arrival_at = ?
      WHERE id = ? AND company_id = ?`)
      .bind(
        input.customer, input.contact, input.customerEmail, input.recipientName, input.recipientContact,
        input.weightKg, input.priceAmount, input.priceCurrency, input.itemDescription, input.destinationSiteId, input.destination,
        input.destinationLatitude, input.destinationLongitude, input.arrivalRadiusKm, input.plannedArrivalAt?.getTime() ?? null,
        deliveryId, companyId,
      ).run();
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async recordEvent(deliveryId, type, progress) {
    const result = await db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, ?, ?, ?)`).bind(deliveryId, type, progress, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listEvents(deliveryId) {
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, type, progress, created_at AS createdAt FROM delivery_events WHERE delivery_id = ? ORDER BY created_at ASC`).bind(deliveryId).all<RawDeliveryEvent>();
    return (result.results ?? []).map(hydrateEvent);
  },
  async recordEtaObservation(input) {
    const result = await db().prepare(`INSERT OR IGNORE INTO delivery_eta_observations
      (delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(input.deliveryId, input.companyId, input.routeTemplateId, input.tripInstanceId, input.destinationSiteId, input.positionAt.getTime(), input.estimatedArrivalAt.getTime(), input.plannedArrivalAt?.getTime() ?? null, input.delayMinutes, input.effectiveSpeedKmh, input.remainingDistanceKm, input.progress, input.confidence, input.source, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listEtaObservations(deliveryId, limit = 200) {
    const capped = Math.max(1, Math.min(2000, Math.round(limit)));
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, company_id AS companyId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt, estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt, delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh, remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt FROM delivery_eta_observations WHERE delivery_id = ? ORDER BY position_at DESC LIMIT ?`).bind(deliveryId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      deliveryId: String(row.deliveryId), companyId: row.companyId == null ? "" : String(row.companyId), routeTemplateId: row.routeTemplateId == null ? null : String(row.routeTemplateId), tripInstanceId: row.tripInstanceId == null ? null : String(row.tripInstanceId), destinationSiteId: row.destinationSiteId == null ? null : String(row.destinationSiteId), positionAt: new Date(Number(row.positionAt)), estimatedArrivalAt: new Date(Number(row.estimatedArrivalAt)),
      plannedArrivalAt: row.plannedArrivalAt == null ? null : new Date(Number(row.plannedArrivalAt)), delayMinutes: row.delayMinutes == null ? null : Number(row.delayMinutes),
      effectiveSpeedKmh: row.effectiveSpeedKmh == null ? null : Number(row.effectiveSpeedKmh), remainingDistanceKm: Number(row.remainingDistanceKm), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async listEtaObservationsForRoute(companyId, routeTemplateId, destinationSiteId, limit = 5000) {
    const capped = Math.max(1, Math.min(10000, Math.round(limit)));
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, company_id AS companyId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt, estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt, delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh, remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt FROM delivery_eta_observations WHERE company_id = ? AND route_template_id = ? AND destination_site_id = ? ORDER BY position_at DESC LIMIT ?`).bind(companyId, routeTemplateId, destinationSiteId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      deliveryId: String(row.deliveryId), companyId: row.companyId == null ? "" : String(row.companyId), routeTemplateId: row.routeTemplateId == null ? null : String(row.routeTemplateId), tripInstanceId: row.tripInstanceId == null ? null : String(row.tripInstanceId), destinationSiteId: row.destinationSiteId == null ? null : String(row.destinationSiteId), positionAt: new Date(Number(row.positionAt)), estimatedArrivalAt: new Date(Number(row.estimatedArrivalAt)),
      plannedArrivalAt: row.plannedArrivalAt == null ? null : new Date(Number(row.plannedArrivalAt)), delayMinutes: row.delayMinutes == null ? null : Number(row.delayMinutes),
      effectiveSpeedKmh: row.effectiveSpeedKmh == null ? null : Number(row.effectiveSpeedKmh), remainingDistanceKm: Number(row.remainingDistanceKm), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async recordTripPosition(input) {
    const result = await db().prepare(`INSERT OR IGNORE INTO trip_position_observations
      (company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(input.companyId, input.routeTemplateId, input.tripInstanceId, input.vehicleId, input.positionAt.getTime(), input.latitude, input.longitude, input.speed, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listTripPositionsForRoute(companyId, routeTemplateId, limit = 10000) {
    const capped = Math.max(1, Math.min(20000, Math.round(limit)));
    const result = await db().prepare(`SELECT company_id AS companyId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, vehicle_id AS vehicleId, position_at AS positionAt, latitude, longitude, speed, created_at AS createdAt FROM trip_position_observations WHERE company_id = ? AND route_template_id = ? ORDER BY position_at DESC LIMIT ?`).bind(companyId, routeTemplateId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      companyId: String(row.companyId), routeTemplateId: String(row.routeTemplateId), tripInstanceId: String(row.tripInstanceId), vehicleId: String(row.vehicleId), positionAt: new Date(Number(row.positionAt)), latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async recordFleetPosition(input) {
    const result = await db().prepare(`INSERT OR IGNORE INTO fleet_position_observations
      (company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.companyId, input.vehicleId, input.vehicleName, input.positionAt.getTime(), input.latitude, input.longitude, input.speed, input.heading, input.address, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listFleetPositions(companyId, vehicleId, limit = 20000) {
    const capped = Math.max(1, Math.min(50000, Math.round(limit)));
    const result = await db().prepare(`SELECT company_id AS companyId, vehicle_id AS vehicleId, vehicle_name AS vehicleName, position_at AS positionAt, latitude, longitude, speed, heading, address, created_at AS createdAt
      FROM fleet_position_observations WHERE company_id = ? AND vehicle_id = ? ORDER BY position_at DESC LIMIT ?`).bind(companyId, vehicleId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      companyId: String(row.companyId), vehicleId: String(row.vehicleId), vehicleName: String(row.vehicleName), positionAt: new Date(Number(row.positionAt)), latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), heading: row.heading == null ? null : Number(row.heading), address: String(row.address ?? ''), createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async upsertTrip(input) {
    const existing = await db().prepare("SELECT id FROM trips WHERE company_id = ? AND id = ? LIMIT 1").bind(input.companyId, input.id).first<{ id: string }>();
    if (!existing) {
      const now = Date.now();
      const stopsJson = JSON.stringify(input.stops.map((stop) => ({ ...stop, plannedArrivalAt: stop.plannedArrivalAt?.getTime() ?? null })));
      await db().prepare("INSERT INTO trips (id, company_id, route_template_id, vehicle_key, truck, sendatrack_vehicle_id, origin_site_id, stops_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(input.id, input.companyId, input.routeTemplateId, input.vehicleKey, input.truck, input.sendatrackVehicleId, input.originSiteId, stopsJson, input.status, now, now).run();
    } else {
      const stopsJson = JSON.stringify(input.stops.map((stop) => ({ ...stop, plannedArrivalAt: stop.plannedArrivalAt?.getTime() ?? null })));
      await db().prepare("UPDATE trips SET route_template_id = ?, vehicle_key = ?, truck = ?, sendatrack_vehicle_id = ?, origin_site_id = ?, stops_json = ?, status = ?, updated_at = ? WHERE company_id = ? AND id = ?").bind(input.routeTemplateId, input.vehicleKey, input.truck, input.sendatrackVehicleId, input.originSiteId, stopsJson, input.status, Date.now(), input.companyId, input.id).run();
    }
    return (await this.getTrip(input.companyId, input.id))!;
  },
  async getTrip(companyId, tripId) {
    const row = await db().prepare("SELECT * FROM trips WHERE company_id = ? AND id = ? LIMIT 1").bind(companyId, tripId).first<Record<string, unknown>>();
    if (!row) return null;
    const rawStops = JSON.parse(String(row.stops_json)) as Array<{ siteId: string; destination: string; sequence: number; plannedArrivalAt: number | null }>;
    return { id: String(row.id), companyId: String(row.company_id), routeTemplateId: String(row.route_template_id), vehicleKey: String(row.vehicle_key), truck: String(row.truck), sendatrackVehicleId: String(row.sendatrack_vehicle_id ?? ''), originSiteId: row.origin_site_id ? String(row.origin_site_id) : null, stops: rawStops.map((stop) => ({ ...stop, plannedArrivalAt: typeof stop.plannedArrivalAt === 'number' ? new Date(stop.plannedArrivalAt) : null })), status: String(row.status) as TripRecord['status'], createdAt: new Date(Number(row.created_at)), updatedAt: new Date(Number(row.updated_at)) };
  },
  async listTrips(companyId, limit = 100) {
    const capped = Math.max(1, Math.min(1000, Math.round(limit)));
    const result = await db().prepare("SELECT id FROM trips WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?").bind(companyId, capped).all<{ id: string }>();
    return (await Promise.all((result.results ?? []).map((row) => this.getTrip(companyId, row.id)))).filter((trip): trip is TripRecord => Boolean(trip));
  },

  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    const result = await db().prepare("UPDATE deliveries SET trip_id = ? WHERE id = ? AND company_id = ? AND (trip_id IS NULL OR trip_id = ?)").bind(tripId, deliveryId, companyId, tripId).run();
    return Boolean(result.meta?.changes);
  },
  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    const result = await db().prepare("UPDATE deliveries SET trip_id = ?, truck = ?, sendatrack_vehicle_id = ? WHERE id = ? AND company_id = ? AND status != 'Delivered' AND trip_id IS NULL AND truck = ? AND sendatrack_vehicle_id = ''")
      .bind(tripId, truck, sendatrackVehicleId, deliveryId, companyId, UNASSIGNED_TRUCK).run();
    if (!result.meta?.changes) return null;
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async listDeliveryIdsForTrip(companyId, tripId) {
    const result = await db().prepare("SELECT id FROM deliveries WHERE company_id = ? AND trip_id = ? ORDER BY created_at ASC").bind(companyId, tripId).all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  },

  async listPendingNotifications(companyId) {
    const staleBefore = Date.now() - 5 * 60_000;
    const result = await db().prepare(`SELECT e.delivery_id AS deliveryId, e.type, e.progress, e.created_at AS createdAt
      FROM delivery_events e
      JOIN deliveries d ON d.id = e.delivery_id
      LEFT JOIN delivery_notifications n ON n.delivery_id = e.delivery_id AND n.event_type = e.type AND n.channel = 'whatsapp'
      WHERE d.company_id = ? AND (n.sent_at IS NULL) AND (n.attempted_at IS NULL OR n.attempted_at < ?)
      ORDER BY e.created_at ASC`).bind(companyId, staleBefore).all<RawDeliveryEvent>();
    const pending = [];
    for (const rawEvent of result.results ?? []) {
      const event = hydrateEvent(rawEvent);
      if (!customerFacingEvent(event.type)) continue;
      const delivery = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? LIMIT 1`).bind(event.deliveryId).first<RawDelivery>();
      if (delivery) pending.push({ delivery: hydrate(delivery), event });
    }
    return pending;
  },
  async claimNotification(deliveryId, type) {
    const now = Date.now();
    const inserted = await db().prepare(`INSERT OR IGNORE INTO delivery_notifications (delivery_id, event_type, channel, attempted_at, sent_at) VALUES (?, ?, 'whatsapp', ?, NULL)`).bind(deliveryId, type, now).run();
    if (inserted.meta?.changes) return true;
    const reclaimed = await db().prepare(`UPDATE delivery_notifications SET attempted_at = ? WHERE delivery_id = ? AND event_type = ? AND channel = 'whatsapp' AND sent_at IS NULL AND attempted_at < ?`).bind(now, deliveryId, type, now - 5 * 60_000).run();
    return Boolean(reclaimed.meta?.changes);
  },
  async markNotificationSent(deliveryId, type) {
    await db().prepare(`UPDATE delivery_notifications SET sent_at = ? WHERE delivery_id = ? AND event_type = ? AND channel = 'whatsapp'`).bind(Date.now(), deliveryId, type).run();
  },
  // Deliberately a no-op: deleting the row here would let a permanently
  // failing send (e.g. an expired provider token) be reclaimed on literally
  // the next call instead of after the stale window, since claimNotification's
  // own "attempted_at < staleBefore" check would have nothing left to
  // compare against once the row is gone.
  async releaseNotification(_deliveryId, _type) {},
  async create(input: CreateDeliveryInput) {
    const delivery: DeliveryRow = {
      ...input,
      whatsappOptIn: input.whatsappOptIn === true,
      whatsappOptInAt: input.whatsappOptIn === true ? (input.whatsappOptInAt ?? new Date()) : null,
      recipientWhatsappOptIn: input.recipientWhatsappOptIn === true,
      recipientWhatsappOptInAt: input.recipientWhatsappOptIn === true ? (input.recipientWhatsappOptInAt ?? new Date()) : null,
      id: createDeliveryId(),
      createdAt: new Date(),
    };
    await db().prepare(`INSERT INTO deliveries
      (id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
       truck, driver, status, eta, planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, customer_email, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, shipment_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.originSiteId, delivery.originLatitude, delivery.originLongitude, delivery.destinationSiteId, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude, delivery.arrivalRadiusKm,
        delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.plannedArrivalAt?.getTime() ?? null, delivery.nextTruckDepartureAt?.getTime() ?? null,
        delivery.progress, delivery.color, delivery.contact, delivery.recipientName ?? "", delivery.recipientContact ?? "", delivery.weightKg ?? null, delivery.priceAmount ?? null, delivery.priceCurrency ?? null, delivery.itemDescription ?? null, delivery.customerEmail ?? null, delivery.whatsappOptIn === true ? 1 : 0, delivery.whatsappOptInAt?.getTime() ?? null, delivery.recipientWhatsappOptIn === true ? 1 : 0, delivery.recipientWhatsappOptInAt?.getTime() ?? null, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.shipmentId ?? null, delivery.createdAt.getTime()).run();
    return delivery;
  },

  async deleteDemoDeliveries(companyId) {
    const result = await db().prepare(`SELECT id FROM deliveries WHERE company_id = ? AND customer LIKE ?`).bind(companyId, `${DEMO_DELIVERY_CUSTOMER_PREFIX}%`).all<{ id: string }>();
    const ids = (result.results ?? []).map((row) => row.id);
    if (!ids.length) return 0;
    const placeholders = ids.map(() => "?").join(",");
    await db().batch([
      db().prepare(`DELETE FROM delivery_events WHERE delivery_id IN (${placeholders})`).bind(...ids),
      db().prepare(`DELETE FROM delivery_notifications WHERE delivery_id IN (${placeholders})`).bind(...ids),
      db().prepare(`DELETE FROM delivery_eta_observations WHERE delivery_id IN (${placeholders})`).bind(...ids),
      db().prepare(`DELETE FROM deliveries WHERE id IN (${placeholders})`).bind(...ids),
    ]);
    return ids.length;
  },

  async deleteDelivery(deliveryId, companyId) {
    const existing = await db().prepare(`SELECT id FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<{ id: string }>();
    if (!existing) return false;
    await db().batch([
      db().prepare(`DELETE FROM delivery_events WHERE delivery_id = ?`).bind(deliveryId),
      db().prepare(`DELETE FROM delivery_notifications WHERE delivery_id = ?`).bind(deliveryId),
      db().prepare(`DELETE FROM delivery_eta_observations WHERE delivery_id = ?`).bind(deliveryId),
      db().prepare(`DELETE FROM deliveries WHERE id = ?`).bind(deliveryId),
    ]);
    return true;
  },

  async advanceDemoDelivery(deliveryId, companyId, input) {
    const existing = await db().prepare(`SELECT id FROM deliveries WHERE id = ? AND company_id = ? AND customer LIKE ? LIMIT 1`)
      .bind(deliveryId, companyId, `${DEMO_DELIVERY_CUSTOMER_PREFIX}%`).first<{ id: string }>();
    if (!existing) return null;
    await db().prepare(`UPDATE deliveries SET status = ?, progress = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'simulation' WHERE id = ? AND company_id = ?`)
      .bind(input.status, input.progress, input.latitude, input.longitude, input.speed, Date.now(), deliveryId, companyId).run();
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
};
