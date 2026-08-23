import { runtimeEnv } from "trackfleet-runtime-env";
import type {
  DeliveryEventRow,
  DeliveryRow,
  DeliveryStatus,
  EtaObservationRow,
  FleetPositionRow,
  TripPositionRow,
} from "./delivery-store.types";
import type { DeliveryEventType } from "./delivery-events";
import type { TripRecord } from "./trip-record";

type D1ReadStatement = {
  bind(...values: unknown[]): D1ReadStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};

type D1ReadBinding = {
  prepare(query: string): D1ReadStatement;
};

type RawDelivery = {
  id: string;
  customer: string;
  originSiteId: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationSiteId: string | null;
  destination: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  arrivalRadiusKm: number | null;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  plannedArrivalAt: number | null;
  nextTruckDepartureAt: number | null;
  progress: number;
  color: string;
  contact: string;
  recipientName: string | null;
  recipientContact: string | null;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: "EUR" | "MAD" | null;
  whatsappOptIn: number | null;
  whatsappOptInAt: number | null;
  recipientWhatsappOptIn: number | null;
  recipientWhatsappOptInAt: number | null;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: number | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  tripId: string | null;
  shipmentId: string | null;
  createdAt: number;
};

type RawDeliveryEvent = {
  deliveryId: string;
  type: DeliveryEventType;
  progress: number;
  createdAt: number;
};

const selectColumns = `id, customer, origin_site_id AS originSiteId, origin_latitude AS originLatitude,
  origin_longitude AS originLongitude, destination_site_id AS destinationSiteId, destination,
  destination_latitude AS destinationLatitude, destination_longitude AS destinationLongitude,
  arrival_radius_km AS arrivalRadiusKm, truck, driver, status, eta,
  planned_arrival_at AS plannedArrivalAt, next_truck_departure_at AS nextTruckDepartureAt, progress, color, contact, recipient_name AS recipientName, recipient_contact AS recipientContact,
  weight_kg AS weightKg, price_amount AS priceAmount, price_currency AS priceCurrency,
  whatsapp_opt_in AS whatsappOptIn, whatsapp_opt_in_at AS whatsappOptInAt,
  recipient_whatsapp_opt_in AS recipientWhatsappOptIn, recipient_whatsapp_opt_in_at AS recipientWhatsappOptInAt,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, trip_id AS tripId, shipment_id AS shipmentId, created_at AS createdAt`;

function db() {
  const binding = (runtimeEnv as unknown as { DB?: D1ReadBinding }).DB;
  if (!binding) throw new Error("D1 database binding is missing");
  return binding;
}

function hydrateDelivery(row: RawDelivery): DeliveryRow {
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

function hydrateEvent(row: RawDeliveryEvent): DeliveryEventRow {
  return { ...row, createdAt: new Date(row.createdAt) };
}

function hydrateEta(row: Record<string, unknown>): EtaObservationRow {
  return {
    deliveryId: String(row.deliveryId),
    routeTemplateId: row.routeTemplateId == null ? null : String(row.routeTemplateId),
    tripInstanceId: row.tripInstanceId == null ? null : String(row.tripInstanceId),
    destinationSiteId: row.destinationSiteId == null ? null : String(row.destinationSiteId),
    positionAt: new Date(Number(row.positionAt)),
    estimatedArrivalAt: new Date(Number(row.estimatedArrivalAt)),
    plannedArrivalAt: row.plannedArrivalAt == null ? null : new Date(Number(row.plannedArrivalAt)),
    delayMinutes: row.delayMinutes == null ? null : Number(row.delayMinutes),
    effectiveSpeedKmh: row.effectiveSpeedKmh == null ? null : Number(row.effectiveSpeedKmh),
    remainingDistanceKm: Number(row.remainingDistanceKm),
    progress: Number(row.progress),
    confidence: String(row.confidence) as EtaObservationRow["confidence"],
    source: String(row.source) as EtaObservationRow["source"],
    createdAt: new Date(Number(row.createdAt)),
  };
}

function hydrateTrip(row: Record<string, unknown>): TripRecord {
  const rawStops = JSON.parse(String(row.stops_json)) as Array<{
    siteId: string;
    destination: string;
    sequence: number;
    plannedArrivalAt: number | null;
  }>;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    routeTemplateId: String(row.route_template_id),
    vehicleKey: String(row.vehicle_key),
    truck: String(row.truck),
    sendatrackVehicleId: String(row.sendatrack_vehicle_id ?? ""),
    originSiteId: row.origin_site_id ? String(row.origin_site_id) : null,
    stops: rawStops.map((stop) => ({
      ...stop,
      plannedArrivalAt: typeof stop.plannedArrivalAt === "number" ? new Date(stop.plannedArrivalAt) : null,
    })),
    status: String(row.status) as TripRecord["status"],
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

export async function getPublicDeliveryFromD1(tracking: string): Promise<DeliveryRow | null> {
  const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE tracking_token = ? LIMIT 1`)
    .bind(tracking)
    .first<RawDelivery>();
  return row ? hydrateDelivery(row) : null;
}

export async function listDeliveryEventsFromD1(deliveryId: string): Promise<DeliveryEventRow[]> {
  const result = await db().prepare(`SELECT delivery_id AS deliveryId, type, progress, created_at AS createdAt
    FROM delivery_events WHERE delivery_id = ? ORDER BY created_at ASC`)
    .bind(deliveryId)
    .all<RawDeliveryEvent>();
  return (result.results ?? []).map(hydrateEvent);
}

export async function listEtaObservationsFromD1(deliveryId: string, limit = 200): Promise<EtaObservationRow[]> {
  const capped = Math.max(1, Math.min(2000, Math.round(limit)));
  const result = await db().prepare(`SELECT delivery_id AS deliveryId, route_template_id AS routeTemplateId,
      trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt,
      estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt,
      delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh,
      remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt
    FROM delivery_eta_observations WHERE delivery_id = ? ORDER BY position_at DESC LIMIT ?`)
    .bind(deliveryId, capped)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(hydrateEta);
}

export async function listRouteEtaObservationsFromD1(routeTemplateId: string, destinationSiteId: string, limit = 5000): Promise<EtaObservationRow[]> {
  const capped = Math.max(1, Math.min(10000, Math.round(limit)));
  const result = await db().prepare(`SELECT delivery_id AS deliveryId, route_template_id AS routeTemplateId,
      trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt,
      estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt,
      delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh,
      remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt
    FROM delivery_eta_observations
    WHERE route_template_id = ? AND destination_site_id = ? ORDER BY position_at DESC LIMIT ?`)
    .bind(routeTemplateId, destinationSiteId, capped)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(hydrateEta);
}

export async function listTripPositionsFromD1(companyId: string, routeTemplateId: string, limit = 10000): Promise<TripPositionRow[]> {
  const capped = Math.max(1, Math.min(20000, Math.round(limit)));
  const result = await db().prepare(`SELECT company_id AS companyId, route_template_id AS routeTemplateId,
      trip_instance_id AS tripInstanceId, vehicle_id AS vehicleId, position_at AS positionAt,
      latitude, longitude, speed, created_at AS createdAt
    FROM trip_position_observations
    WHERE company_id = ? AND route_template_id = ? ORDER BY position_at DESC LIMIT ?`)
    .bind(companyId, routeTemplateId, capped)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map((row): TripPositionRow => ({
    companyId: String(row.companyId),
    routeTemplateId: String(row.routeTemplateId),
    tripInstanceId: String(row.tripInstanceId),
    vehicleId: String(row.vehicleId),
    positionAt: new Date(Number(row.positionAt)),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speed: Number(row.speed),
    createdAt: new Date(Number(row.createdAt)),
  }));
}

export async function listFleetPositionsFromD1(companyId: string, vehicleId: string, limit = 20000): Promise<FleetPositionRow[]> {
  const capped = Math.max(1, Math.min(50000, Math.round(limit)));
  const result = await db().prepare(`SELECT company_id AS companyId, vehicle_id AS vehicleId,
      vehicle_name AS vehicleName, position_at AS positionAt, latitude, longitude, speed,
      heading, address, created_at AS createdAt
    FROM fleet_position_observations
    WHERE company_id = ? AND vehicle_id = ? ORDER BY position_at DESC LIMIT ?`)
    .bind(companyId, vehicleId, capped)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map((row): FleetPositionRow => ({
    companyId: String(row.companyId),
    vehicleId: String(row.vehicleId),
    vehicleName: String(row.vehicleName),
    positionAt: new Date(Number(row.positionAt)),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speed: Number(row.speed),
    heading: row.heading == null ? null : Number(row.heading),
    address: String(row.address ?? ""),
    createdAt: new Date(Number(row.createdAt)),
  }));
}

export async function getTripFromD1(companyId: string, tripId: string): Promise<TripRecord | null> {
  const row = await db().prepare("SELECT * FROM trips WHERE company_id = ? AND id = ? LIMIT 1")
    .bind(companyId, tripId)
    .first<Record<string, unknown>>();
  return row ? hydrateTrip(row) : null;
}

export async function listTripsFromD1(companyId: string, limit = 100): Promise<TripRecord[]> {
  const capped = Math.max(1, Math.min(1000, Math.round(limit)));
  const result = await db().prepare("SELECT * FROM trips WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?")
    .bind(companyId, capped)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(hydrateTrip);
}

export async function listDeliveryIdsForTripFromD1(companyId: string, tripId: string): Promise<string[]> {
  const result = await db().prepare("SELECT id FROM deliveries WHERE company_id = ? AND trip_id = ? ORDER BY created_at ASC")
    .bind(companyId, tripId)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}
