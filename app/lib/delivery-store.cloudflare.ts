import { runtimeEnv } from "trackfleet-runtime-env";
import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryStatus, DeliveryTransition } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return runtimeEnv.DB;
}
function key(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

type RawDelivery = {
  id: string; customer: string; destination: string;
  destinationLatitude: number | null; destinationLongitude: number | null; arrivalRadiusKm: number | null;
  truck: string; driver: string; status: DeliveryStatus; eta: string; progress: number; color: string; contact: string;
  sendatrackVehicleId: string; latitude: number | null; longitude: number | null; speed: number | null;
  lastPositionAt: number | null; gpsSource: string; companyId: string; trackingToken: string | null; createdAt: number;
};
type RawDeliveryEvent = { deliveryId: string; type: DeliveryEventType; progress: number; createdAt: number };
function hydrate(row: RawDelivery): DeliveryRow {
  return {
    ...row,
    destinationLatitude: row.destinationLatitude ?? null,
    destinationLongitude: row.destinationLongitude ?? null,
    arrivalRadiusKm: row.arrivalRadiusKm ?? 0.5,
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

async function ensureDeliveryColumns() {
  const result = await db().prepare("PRAGMA table_info(deliveries)").all<{ name: string }>();
  const columns = new Set((result.results ?? []).map((column) => column.name));
  if (!columns.has("destination_latitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN destination_latitude real").run();
  if (!columns.has("destination_longitude")) await db().prepare("ALTER TABLE deliveries ADD COLUMN destination_longitude real").run();
  if (!columns.has("arrival_radius_km")) await db().prepare("ALTER TABLE deliveries ADD COLUMN arrival_radius_km real DEFAULT 0.5 NOT NULL").run();
}

async function ensureTable() {
  const database = db();
  await database.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
    id text PRIMARY KEY NOT NULL, customer text NOT NULL, destination text NOT NULL,
    destination_latitude real, destination_longitude real, arrival_radius_km real DEFAULT 0.5 NOT NULL,
    truck text NOT NULL, driver text NOT NULL, status text NOT NULL, eta text NOT NULL, progress integer DEFAULT 0 NOT NULL,
    color text DEFAULT '#916ed7' NOT NULL, contact text DEFAULT '' NOT NULL, sendatrack_vehicle_id text DEFAULT '' NOT NULL,
    latitude real, longitude real, speed real, last_position_at integer, gps_source text DEFAULT 'simulation' NOT NULL,
    company_id text DEFAULT 'demo' NOT NULL, tracking_token text, created_at integer NOT NULL
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
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_tracking_token ON deliveries(tracking_token)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events(delivery_id)"),
  ]);
  for (const delivery of seedDeliveries) {
    await database.prepare(`INSERT OR IGNORE INTO deliveries
      (id, customer, destination, destination_latitude, destination_longitude, arrival_radius_km,
       truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude, delivery.arrivalRadiusKm,
        delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
  }
}

const selectColumns = `id, customer, destination,
  destination_latitude AS destinationLatitude, destination_longitude AS destinationLongitude, arrival_radius_km AS arrivalRadiusKm,
  truck, driver, status, eta, progress, color, contact,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, created_at AS createdAt`;

async function baselineProgress(deliveryId: string) {
  const row = await db().prepare("SELECT progress FROM delivery_events WHERE delivery_id = ? AND type = 'GPS_BASELINE' LIMIT 1").bind(deliveryId).first<{ progress: number }>();
  return row?.progress ?? 0;
}

export const store: DeliveryStore = {
  async getPublic(tracking) {
    await ensureTable();
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE tracking_token = ? OR (company_id = 'demo' AND id = ?) LIMIT 1`).bind(tracking, tracking).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },
  async listForCompany(companyId) {
    await ensureTable();
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE company_id = ? OR company_id = 'demo' ORDER BY created_at DESC`).bind(companyId).all<RawDelivery>();
    return (result.results ?? []).map(hydrate);
  },
  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    await ensureTable();
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries WHERE (company_id = ? OR company_id = 'demo') AND status != 'Delivered'`).bind(companyId).all<RawDelivery>();
    const statements = [];
    for (const rawDelivery of result.results ?? []) {
      const delivery = hydrate(rawDelivery);
      const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId) ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
      if (!vehicle) continue;
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery));
      const metrics = rebaseRouteMetrics(absoluteMetrics, await baselineProgress(delivery.id));
      const state = deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress, delivery.arrivalRadiusKm);
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const events = detectDeliveryEvents({ previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes });
      statements.push(db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', progress = ?, status = ? WHERE id = ?`).bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, state.progress, state.status, delivery.id));
      transitions.push({ delivery: { ...delivery, sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", progress: state.progress, status: state.status }, events });
    }
    if (statements.length) await db().batch(statements);
    return transitions;
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
  async listPendingNotifications(companyId) {
    await ensureTable();
    const staleBefore = Date.now() - 5 * 60_000;
    const result = await db().prepare(`SELECT e.delivery_id AS deliveryId, e.type, e.progress, e.created_at AS createdAt
      FROM delivery_events e
      JOIN deliveries d ON d.id = e.delivery_id
      LEFT JOIN delivery_notifications n ON n.delivery_id = e.delivery_id AND n.event_type = e.type AND n.channel = 'whatsapp'
      WHERE (d.company_id = ? OR d.company_id = 'demo') AND (n.sent_at IS NULL) AND (n.attempted_at IS NULL OR n.attempted_at < ?)
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
      (id, customer, destination, destination_latitude, destination_longitude, arrival_radius_km,
       truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude, delivery.arrivalRadiusKm,
        delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
    return delivery;
  },
};
