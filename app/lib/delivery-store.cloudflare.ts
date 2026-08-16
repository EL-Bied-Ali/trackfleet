import { runtimeEnv } from "trackfleet-runtime-env";
import { seedDeliveries } from "./delivery-seed";
import type { CreateDeliveryInput, DeliveryRow, DeliveryStore, DeliveryStatus } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return runtimeEnv.DB;
}

function key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type RawDelivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  progress: number;
  color: string;
  contact: string;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: number | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  createdAt: number;
};

function hydrate(row: RawDelivery): DeliveryRow {
  return {
    ...row,
    lastPositionAt: row.lastPositionAt ? new Date(row.lastPositionAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

async function ensureTable() {
  const database = db();
  await database.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
    id text PRIMARY KEY NOT NULL,
    customer text NOT NULL,
    destination text NOT NULL,
    truck text NOT NULL,
    driver text NOT NULL,
    status text NOT NULL,
    eta text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    color text DEFAULT '#916ed7' NOT NULL,
    contact text DEFAULT '' NOT NULL,
    sendatrack_vehicle_id text DEFAULT '' NOT NULL,
    latitude real,
    longitude real,
    speed real,
    last_position_at integer,
    gps_source text DEFAULT 'simulation' NOT NULL,
    company_id text DEFAULT 'demo' NOT NULL,
    tracking_token text,
    created_at integer NOT NULL
  )`).run();
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_tracking_token ON deliveries(tracking_token)"),
  ]);

  for (const delivery of seedDeliveries) {
    await database.prepare(`INSERT OR IGNORE INTO deliveries
      (id, customer, destination, truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        delivery.id, delivery.customer, delivery.destination, delivery.truck, delivery.driver, delivery.status,
        delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime(),
      ).run();
  }
}

const selectColumns = `id, customer, destination, truck, driver, status, eta, progress, color, contact,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, created_at AS createdAt`;

export const store: DeliveryStore = {
  async getPublic(tracking) {
    await ensureTable();
    const row = await db().prepare(`SELECT ${selectColumns} FROM deliveries
      WHERE tracking_token = ? OR (company_id = 'demo' AND id = ?) LIMIT 1`)
      .bind(tracking, tracking).first<RawDelivery>();
    return row ? hydrate(row) : null;
  },

  async listForCompany(companyId) {
    await ensureTable();
    const result = await db().prepare(`SELECT ${selectColumns} FROM deliveries
      WHERE company_id = ? OR company_id = 'demo' ORDER BY created_at DESC`)
      .bind(companyId).all<RawDelivery>();
    return (result.results ?? []).map((row) => hydrate(row));
  },

  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    if (!snapshot.connected || !snapshot.vehicles.length) return;
    await ensureTable();
    const result = await db().prepare(`SELECT id, truck, destination, status,
      sendatrack_vehicle_id AS sendatrackVehicleId, company_id AS companyId
      FROM deliveries WHERE (company_id = ? OR company_id = 'demo') AND status != 'Delivered'`)
      .bind(companyId).all<{
        id: string;
        truck: string;
        destination: string;
        status: DeliveryStatus;
        sendatrackVehicleId: string;
        companyId: string;
      }>();
    const statements = [];
    for (const delivery of result.results ?? []) {
      const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId)
        ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
      if (!vehicle) continue;

      const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination);
      const state = deriveDeliveryState(delivery.status, metrics, vehicle.speed);

      statements.push(db().prepare(`UPDATE deliveries SET
        sendatrack_vehicle_id = ?, truck = ?, latitude = ?, longitude = ?, speed = ?,
        last_position_at = ?, gps_source = 'sendatrack', progress = ?, status = ? WHERE id = ?`)
        .bind(
          vehicle.id,
          vehicle.name,
          vehicle.latitude,
          vehicle.longitude,
          vehicle.speed,
          vehicle.updatedAt,
          state.progress,
          state.status,
          delivery.id,
        ));
    }
    if (statements.length) await db().batch(statements);
  },

  async create(input: CreateDeliveryInput) {
    await ensureTable();
    const delivery: DeliveryRow = {
      ...input,
      id: `TF-${String(Date.now()).slice(-6)}`,
      createdAt: new Date(),
    };
    await db().prepare(`INSERT INTO deliveries
      (id, customer, destination, truck, driver, status, eta, progress, color, contact, sendatrack_vehicle_id,
       latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        delivery.id, delivery.customer, delivery.destination, delivery.truck, delivery.driver, delivery.status,
        delivery.eta, delivery.progress, delivery.color, delivery.contact, delivery.sendatrackVehicleId,
        delivery.latitude, delivery.longitude, delivery.speed, delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource, delivery.companyId, delivery.trackingToken, delivery.createdAt.getTime(),
      ).run();
    return delivery;
  },
};
