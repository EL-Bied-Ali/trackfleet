import { runtimeEnv } from "trackfleet-runtime-env";
import { seedDeliveries } from "./delivery-seed";
import { detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryStatus, DeliveryTransition } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return runtimeEnv.DB;
}

function key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type RawDelivery = {
  id: string; customer: string; destination: string; truck: string; driver: string; status: DeliveryStatus; eta: string; progress: number; color: string; contact: string;
  sendatrackVehicleId: string; latitude: number | null; longitude: number | null; speed: number | null; lastPositionAt: number | null; gpsSource: string; companyId: string; trackingToken: string | null; createdAt: number;
};
type RawDeliveryEvent = { deliveryId: string; type: DeliveryEventType; progress: number; createdAt: number };

function hydrate(row: RawDelivery): DeliveryRow {
  return { ...row, lastPositionAt: row.lastPositionAt ? new Date(row.lastPositionAt) : null, createdAt: new Date(row.createdAt) };
}
function hydrateEvent(row: RawDeliveryEvent): DeliveryEventRow { return { ...row, createdAt: new Date(row.createdAt) }; }

async function ensureTable() {
  const database = db();
  await database.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
    id text PRIMARY KEY NOT NULL, customer text NOT NULL, destination text NOT NULL, truck text NOT NULL,
    driver text NOT NULL, status text NOT NULL, eta text NOT NULL, progress integer DEFAULT 0 NOT NULL,
    color text DEFAULT '#916ed7' NOT NULL, contact text DEFAULT '' NOT NULL, sendatrack_vehicle_id text DEFAULT '' NOT NULL,
    latitude real, longitude real, speed real, last_position_at integer, gps_source text DEFAULT 'simulation' NOT NULL,
    company_id text DEFAULT 'demo' NOT NULL, tracking_token text, created_at integer NOT NULL
  )`).run();
  await database.prepare(`CREATE TABLE IF NOT EXISTS delivery_events (
    delivery_id text NOT NULL, type text NOT NULL, progress integer NOT NULL, created_at integer NOT NULL,
    PRIMARY KEY (delivery_id, type)
  )`).run();
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_tracking_token ON deliveries(tracking_token)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events(delivery_id)"),
  ]);

  for (const delivery of seedDeliveries) {
    await database.prepare(`INSERT OR IGNORE INTO deliveries
      (id, customer, destination, truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.destination, delivery.truck, delivery.driver, delivery.status,
        delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
  }
}

const selectColumns = `id, customer, destination, truck, driver, status, eta, progress, color, contact,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, created_at AS createdAt`;

async function baselineProgress(deliveryId: string) {
  const row = await db().prepare("SELECT progress FROM delivery_events WHERE delivery_id = ? AND type = 'GPS_BASELINE' LIMIT 1")
    .bind(deliveryId).first<{ progress: number }>();
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
      const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId)
        ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
      if (!vehicle) continue;

      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination);
      const metrics = rebaseRouteMetrics(absoluteMetrics, await baselineProgress(delivery.id));
      const state = deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress);
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const events = detectDeliveryEvents({ previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes });

      statements.push(db().prepare(`UPDATE deliveries SET sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?, last_position_at = ?, gps_source = 'sendatrack', progress = ?, status = ? WHERE id = ?`)
        .bind(vehicle.id, vehicle.name, vehicle.latitude, vehicle.longitude, vehicle.speed, vehicle.updatedAt, state.progress, state.status, delivery.id));
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

  async create(input: CreateDeliveryInput) {
    await ensureTable();
    const delivery: DeliveryRow = { ...input, id: `TF-${String(Date.now()).slice(-6)}`, createdAt: new Date() };
    await db().prepare(`INSERT INTO deliveries
      (id, customer, destination, truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(delivery.id, delivery.customer, delivery.destination, delivery.truck, delivery.driver, delivery.status,
        delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime()).run();
    return delivery;
  },
};
