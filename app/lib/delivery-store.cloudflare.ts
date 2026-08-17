import { runtimeEnv } from "trackfleet-runtime-env";
import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryStatus, DeliveryTransition, EtaObservationRow } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";
import { matchDeliveryVehicle } from "./vehicle-linking";
import { UNASSIGNED_TRUCK } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record";

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return runtimeEnv.DB;
}

type RawDelivery = {
  id: string; customer: string; originSiteId: string | null; originLatitude: number | null; originLongitude: number | null; destinationSiteId: string | null; destination: string;
  destinationLatitude: number | null; destinationLongitude: number | null; arrivalRadiusKm: number | null;
  truck: string; driver: string; status: DeliveryStatus; eta: string; plannedArrivalAt: number | null;
  progress: number; color: string; contact: string;
  sendatrackVehicleId: string; latitude: number | null; longitude: number | null; speed: number | null;
  lastPositionAt: number | null; gpsSource: string; companyId: string; trackingToken: string | null; tripId: string | null; createdAt: number;
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
    plannedArrivalAt: row.plannedArrivalAt ? new Date(row.plannedArrivalAt) : null,
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

async function ensureDeliveryColumns() {
  const result = await db().prepare("PRAGMA table_info(deliveries)").all<{ name: string }>();
  const columns = new Set((result.results ?? []).map((column) => column.name));
  if (!columns.has("origin_site_id")) await db().prepare("ALTER TABLE deliveries ADD COLUMN origin_site_id text").run();
  if (!columns.has("origin_latitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN origin_latitude real").run();
  if (!columns.has("origin_longitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN origin_longitude real").run();
  if (!columns.has("destination_site_id")) await db().prepare("ALTER TABLE deliveries ADD COLUMN destination_site_id text").run();
  if (!columns.has("destination_latitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN destination_latitude real").run();
  if (!columns.has("destination_longitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN destination_longitude real").run();
  if (!columns.has("arrival_radius_km")) await db().prepare("ALTER TABLE deliveries ADD COLUMN arrival_radius_km real DEFAULT 0.5 NOT NULL").run();
  if (!columns.has("planned_arrival_at")) await db().prepare("ALTER TABLE deliveries ADD COLUMN planned_arrival_at integer").run();
  if (!columns.has("trip_id")) await db().prepare("ALTER TABLE deliveries ADD COLUMN trip_id text").run();
}

async function ensureTable() {
  const database = db();
  await database.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
    id text PRIMARY KEY NOT NULL, customer text NOT NULL, origin_site_id text, origin_latitude real, origin_longitude real, destination_site_id text, destination text NOT NULL,
    destination_latitude real, destination_longitude real, arrival_radius_km real DEFAULT 0.5 NOT NULL,
    truck text NOT NULL, driver text NOT NULL, status text NOT NULL, eta text NOT NULL, planned_arrival_at integer,
    progress integer DEFAULT 0 NOT NULL, color text DEFAULT '#916ed7' NOT NULL, contact text DEFAULT '' NOT NULL,
    sendatrack_vehicle_id text DEFAULT '' NOT NULL, latitude real, longitude real, speed real, last_position_at integer,
    gps_source text DEFAULT 'simulation' NOT NULL, company_id text DEFAULT 'demo' NOT NULL, tracking_token text, created_at integer NOT NULL
  )`).run();
  await ensureDeliveryColumns();
  await database.prepare(`CREATE TABLE IF NOT EXISTS delivery_events (
    delivery_id text NOT NULL, type text NOT NULL, progress integer NOT NULL, created_at integer NOT NULL,
    PRIMARY KEY (delivery_id, type)
  )`).run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS delivery_notifications (
    delivery_id text NOT NULL, event_type text NOT NULL, channel text NOT NULL,
    attempted_at integer NOT NULL, sent_at integer,
    PRIMARY KEY (delivery_id, event_type, channel)
  )`).run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS delivery_eta_observations (
    delivery_id text NOT NULL, position_at integer NOT NULL, estimated_arrival_at integer NOT NULL, planned_arrival_at integer,
    delay_minutes integer, effective_speed_kmh real, remaining_distance_km real NOT NULL, progress integer NOT NULL,
    confidence text NOT NULL, source text NOT NULL, created_at integer NOT NULL, PRIMARY KEY (delivery_id, position_at)
  )`).run();
  const etaColumnsResult = await database.prepare("PRAGMA table_info(delivery_eta_observations)").all<{ name: string }>();
  const etaColumns = new Set((etaColumnsResult.results ?? []).map((column) => column.name));
  if (!etaColumns.has("route_template_id")) await database.prepare("ALTER TABLE delivery_eta_observations ADD COLUMN route_template_id text").run();
  if (!etaColumns.has("trip_instance_id")) await database.prepare("ALTER TABLE delivery_eta_observations ADD COLUMN trip_instance_id text").run();
  if (!etaColumns.has("destination_site_id")) await database.prepare("ALTER TABLE delivery_eta_observations ADD COLUMN destination_site_id text").run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS trip_position_observations (
    company_id text NOT NULL, route_template_id text NOT NULL, trip_instance_id text NOT NULL, vehicle_id text NOT NULL,
    position_at integer NOT NULL, latitude real NOT NULL, longitude real NOT NULL, speed real NOT NULL, created_at integer NOT NULL,
    PRIMARY KEY (company_id, trip_instance_id, position_at)
  )`).run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS trips (
    id text NOT NULL, company_id text NOT NULL, route_template_id text NOT NULL, vehicle_key text NOT NULL, truck text NOT NULL,
    sendatrack_vehicle_id text DEFAULT '' NOT NULL, origin_site_id text, stops_json text NOT NULL, status text NOT NULL,
    created_at integer NOT NULL, updated_at integer NOT NULL, PRIMARY KEY (company_id, id)
  )`).run();
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_deliveries_company_trip ON deliveries(company_id, trip_id)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_tracking_token ON deliveries(tracking_token)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events(delivery_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_eta_observations_delivery_position ON delivery_eta_observations(delivery_id, position_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_eta_observations_route_destination ON delivery_eta_observations(route_template_id, destination_site_id, position_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_trip_positions_company_route ON trip_position_observations(company_id, route_template_id, position_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_trips_company_updated ON trips(company_id, updated_at DESC)"),
  ]);
  for (const delivery of seedDeliveries) {
    await database.prepare(`INSERT OR IGNORE INTO deliveries
      (id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
       truck, driver, status, eta, planned_arrival_at, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.originSiteId, delivery.originLatitude, delivery.originLongitude, delivery.destinationSiteId, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude, delivery.arrivalRadiusKm,
        delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.plannedArrivalAt?.getTime() ?? null,
        delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
  }
}

const selectColumns = `id, customer, origin_site_id AS originSiteId, origin_latitude AS originLatitude, origin_longitude AS originLongitude, destination_site_id AS destinationSiteId, destination,
  destination_latitude AS destinationLatitude, destination_longitude AS destinationLongitude, arrival_radius_km AS arrivalRadiusKm,
  truck, driver, status, eta, planned_arrival_at AS plannedArrivalAt, progress, color, contact,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, trip_id AS tripId, created_at AS createdAt`;

async function baselineProgress(deliveryId: string) {
  const row = await db().prepare("SELECT progress FROM delivery_events WHERE delivery_id = ? AND type = 'GPS_BASELINE' LIMIT 1").bind(deliveryId).first<{ progress: number }>();
  return row?.progress ?? 0;
}

export const store: DeliveryStore = {
  async getPublic(tracking) {
    await ensureTable();
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE tracking_token = ? LIMIT 1`).bind(tracking).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },
  async listForCompany(companyId) {
    await ensureTable();
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE company_id = ? ORDER BY created_at DESC`).bind(companyId).all<RawDelivery>();
    return (result.results ?? []).map(hydrate);
  },
  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    await ensureTable();
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
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), origin);
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
    await ensureTable();
    const raw = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    if (!raw) return null;
    const delivery = hydrate(raw);
    const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), explicitOrigin(delivery));
    await db().batch([
      db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'GPS_BASELINE', ?, ?)`).bind(delivery.id, metrics.progress, Date.now()),
      db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', status = 'Loading' WHERE id = ? AND company_id = ?`).bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, delivery.id, companyId),
    ]);
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(delivery.id, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async recordEvent(deliveryId, type, progress) {
    await ensureTable();
    const result = await db().prepare(`INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, ?, ?, ?)`).bind(deliveryId, type, progress, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listEvents(deliveryId) {
    await ensureTable();
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, type, progress, created_at AS createdAt FROM delivery_events WHERE delivery_id = ? ORDER BY created_at ASC`).bind(deliveryId).all<RawDeliveryEvent>();
    return (result.results ?? []).map(hydrateEvent);
  },
  async recordEtaObservation(input) {
    await ensureTable();
    const result = await db().prepare(`INSERT OR IGNORE INTO delivery_eta_observations
      (delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(input.deliveryId, input.routeTemplateId, input.tripInstanceId, input.destinationSiteId, input.positionAt.getTime(), input.estimatedArrivalAt.getTime(), input.plannedArrivalAt?.getTime() ?? null, input.delayMinutes, input.effectiveSpeedKmh, input.remainingDistanceKm, input.progress, input.confidence, input.source, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listEtaObservations(deliveryId, limit = 200) {
    await ensureTable();
    const capped = Math.max(1, Math.min(2000, Math.round(limit)));
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt, estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt, delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh, remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt FROM delivery_eta_observations WHERE delivery_id = ? ORDER BY position_at DESC LIMIT ?`).bind(deliveryId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      deliveryId: String(row.deliveryId), routeTemplateId: row.routeTemplateId == null ? null : String(row.routeTemplateId), tripInstanceId: row.tripInstanceId == null ? null : String(row.tripInstanceId), destinationSiteId: row.destinationSiteId == null ? null : String(row.destinationSiteId), positionAt: new Date(Number(row.positionAt)), estimatedArrivalAt: new Date(Number(row.estimatedArrivalAt)),
      plannedArrivalAt: row.plannedArrivalAt == null ? null : new Date(Number(row.plannedArrivalAt)), delayMinutes: row.delayMinutes == null ? null : Number(row.delayMinutes),
      effectiveSpeedKmh: row.effectiveSpeedKmh == null ? null : Number(row.effectiveSpeedKmh), remainingDistanceKm: Number(row.remainingDistanceKm), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit = 5000) {
    await ensureTable();
    const capped = Math.max(1, Math.min(10000, Math.round(limit)));
    const result = await db().prepare(`SELECT delivery_id AS deliveryId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, destination_site_id AS destinationSiteId, position_at AS positionAt, estimated_arrival_at AS estimatedArrivalAt, planned_arrival_at AS plannedArrivalAt, delay_minutes AS delayMinutes, effective_speed_kmh AS effectiveSpeedKmh, remaining_distance_km AS remainingDistanceKm, progress, confidence, source, created_at AS createdAt FROM delivery_eta_observations WHERE route_template_id = ? AND destination_site_id = ? ORDER BY position_at DESC LIMIT ?`).bind(routeTemplateId, destinationSiteId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      deliveryId: String(row.deliveryId), routeTemplateId: row.routeTemplateId == null ? null : String(row.routeTemplateId), tripInstanceId: row.tripInstanceId == null ? null : String(row.tripInstanceId), destinationSiteId: row.destinationSiteId == null ? null : String(row.destinationSiteId), positionAt: new Date(Number(row.positionAt)), estimatedArrivalAt: new Date(Number(row.estimatedArrivalAt)),
      plannedArrivalAt: row.plannedArrivalAt == null ? null : new Date(Number(row.plannedArrivalAt)), delayMinutes: row.delayMinutes == null ? null : Number(row.delayMinutes),
      effectiveSpeedKmh: row.effectiveSpeedKmh == null ? null : Number(row.effectiveSpeedKmh), remainingDistanceKm: Number(row.remainingDistanceKm), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async recordTripPosition(input) {
    await ensureTable();
    const result = await db().prepare(`INSERT OR IGNORE INTO trip_position_observations
      (company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(input.companyId, input.routeTemplateId, input.tripInstanceId, input.vehicleId, input.positionAt.getTime(), input.latitude, input.longitude, input.speed, Date.now()).run();
    return Boolean(result.meta?.changes);
  },
  async listTripPositionsForRoute(companyId, routeTemplateId, limit = 10000) {
    await ensureTable();
    const capped = Math.max(1, Math.min(20000, Math.round(limit)));
    const result = await db().prepare(`SELECT company_id AS companyId, route_template_id AS routeTemplateId, trip_instance_id AS tripInstanceId, vehicle_id AS vehicleId, position_at AS positionAt, latitude, longitude, speed, created_at AS createdAt FROM trip_position_observations WHERE company_id = ? AND route_template_id = ? ORDER BY position_at DESC LIMIT ?`).bind(companyId, routeTemplateId, capped).all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      companyId: String(row.companyId), routeTemplateId: String(row.routeTemplateId), tripInstanceId: String(row.tripInstanceId), vehicleId: String(row.vehicleId), positionAt: new Date(Number(row.positionAt)), latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), createdAt: new Date(Number(row.createdAt)),
    }));
  },
  async upsertTrip(input) {
    await ensureTable();
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
    await ensureTable();
    const row = await db().prepare("SELECT * FROM trips WHERE company_id = ? AND id = ? LIMIT 1").bind(companyId, tripId).first<Record<string, unknown>>();
    if (!row) return null;
    const rawStops = JSON.parse(String(row.stops_json)) as Array<{ siteId: string; destination: string; sequence: number; plannedArrivalAt: number | null }>;
    return { id: String(row.id), companyId: String(row.company_id), routeTemplateId: String(row.route_template_id), vehicleKey: String(row.vehicle_key), truck: String(row.truck), sendatrackVehicleId: String(row.sendatrack_vehicle_id ?? ''), originSiteId: row.origin_site_id ? String(row.origin_site_id) : null, stops: rawStops.map((stop) => ({ ...stop, plannedArrivalAt: typeof stop.plannedArrivalAt === 'number' ? new Date(stop.plannedArrivalAt) : null })), status: String(row.status) as TripRecord['status'], createdAt: new Date(Number(row.created_at)), updatedAt: new Date(Number(row.updated_at)) };
  },
  async listTrips(companyId, limit = 100) {
    await ensureTable();
    const capped = Math.max(1, Math.min(1000, Math.round(limit)));
    const result = await db().prepare("SELECT id FROM trips WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?").bind(companyId, capped).all<{ id: string }>();
    return (await Promise.all((result.results ?? []).map((row) => this.getTrip(companyId, row.id)))).filter((trip): trip is TripRecord => Boolean(trip));
  },

  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    await ensureTable();
    const result = await db().prepare("UPDATE deliveries SET trip_id = ? WHERE id = ? AND company_id = ? AND (trip_id IS NULL OR trip_id = ?)").bind(tripId, deliveryId, companyId, tripId).run();
    return Boolean(result.meta?.changes);
  },
  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    await ensureTable();
    const result = await db().prepare("UPDATE deliveries SET trip_id = ?, truck = ?, sendatrack_vehicle_id = ? WHERE id = ? AND company_id = ? AND status != 'Delivered' AND trip_id IS NULL AND truck = ? AND sendatrack_vehicle_id = ''")
      .bind(tripId, truck, sendatrackVehicleId, deliveryId, companyId, UNASSIGNED_TRUCK).run();
    if (!result.meta?.changes) return null;
    const updated = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1`).bind(deliveryId, companyId).first<RawDelivery>();
    return updated ? hydrate(updated) : null;
  },
  async listDeliveryIdsForTrip(companyId, tripId) {
    await ensureTable();
    const result = await db().prepare("SELECT id FROM deliveries WHERE company_id = ? AND trip_id = ? ORDER BY created_at ASC").bind(companyId, tripId).all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  },

  async listPendingNotifications(companyId) {
    await ensureTable();
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
    await ensureTable();
    const now = Date.now();
    const inserted = await db().prepare(`INSERT OR IGNORE INTO delivery_notifications (delivery_id, event_type, channel, attempted_at, sent_at) VALUES (?, ?, 'whatsapp', ?, NULL)`).bind(deliveryId, type, now).run();
    if (inserted.meta?.changes) return true;
    const reclaimed = await db().prepare(`UPDATE delivery_notifications SET attempted_at = ? WHERE delivery_id = ? AND event_type = ? AND channel = 'whatsapp' AND sent_at IS NULL AND attempted_at < ?`).bind(now, deliveryId, type, now - 5 * 60_000).run();
    return Boolean(reclaimed.meta?.changes);
  },
  async markNotificationSent(deliveryId, type) {
    await ensureTable();
    await db().prepare(`UPDATE delivery_notifications SET sent_at = ? WHERE delivery_id = ? AND event_type = ? AND channel = 'whatsapp'`).bind(Date.now(), deliveryId, type).run();
  },
  async releaseNotification(deliveryId, type) {
    await ensureTable();
    await db().prepare(`DELETE FROM delivery_notifications WHERE delivery_id = ? AND event_type = ? AND channel = 'whatsapp' AND sent_at IS NULL`).bind(deliveryId, type).run();
  },
  async create(input: CreateDeliveryInput) {
    await ensureTable();
    const delivery: DeliveryRow = { ...input, id: `TF-${String(Date.now()).slice(-6)}`, createdAt: new Date() };
    await db().prepare(`INSERT INTO deliveries
      (id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
       truck, driver, status, eta, planned_arrival_at, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.originSiteId, delivery.originLatitude, delivery.originLongitude, delivery.destinationSiteId, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude, delivery.arrivalRadiusKm,
        delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.plannedArrivalAt?.getTime() ?? null,
        delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
    return delivery;
  },
};