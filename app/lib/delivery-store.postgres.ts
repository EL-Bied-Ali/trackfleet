import { neon } from "@neondatabase/serverless";
import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStatus, DeliveryStore, DeliveryTransition, EtaObservationRow } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";
import { matchDeliveryVehicle } from "./vehicle-linking";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres delivery store");
const sql = neon(databaseUrl);
let schemaPromise: Promise<void> | null = null;

type RawDelivery = {
  id: string;
  customer: string;
  origin_site_id: string | null;
  origin_latitude: number | string | null;
  origin_longitude: number | string | null;
  destination_site_id: string | null;
  destination: string;
  destination_latitude: number | string | null;
  destination_longitude: number | string | null;
  arrival_radius_km: number | string | null;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  planned_arrival_at: string | Date | null;
  progress: number;
  color: string;
  contact: string;
  sendatrack_vehicle_id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  speed: number | string | null;
  last_position_at: string | Date | null;
  gps_source: string;
  company_id: string;
  tracking_token: string | null;
  created_at: string | Date;
};

type RawEvent = {
  delivery_id: string;
  type: DeliveryEventType;
  progress: number;
  created_at: string | Date;
};

function numberOrNull(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function hydrate(row: RawDelivery): DeliveryRow {
  return {
    id: row.id,
    customer: row.customer,
    originSiteId: row.origin_site_id ?? null,
    originLatitude: numberOrNull(row.origin_latitude),
    originLongitude: numberOrNull(row.origin_longitude),
    destinationSiteId: row.destination_site_id ?? null,
    destination: row.destination,
    destinationLatitude: numberOrNull(row.destination_latitude),
    destinationLongitude: numberOrNull(row.destination_longitude),
    arrivalRadiusKm: numberOrNull(row.arrival_radius_km) ?? 0.5,
    truck: row.truck,
    driver: row.driver,
    status: row.status,
    eta: row.eta,
    plannedArrivalAt: row.planned_arrival_at ? new Date(row.planned_arrival_at) : null,
    progress: Number(row.progress),
    color: row.color,
    contact: row.contact,
    sendatrackVehicleId: row.sendatrack_vehicle_id,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    speed: numberOrNull(row.speed),
    lastPositionAt: row.last_position_at ? new Date(row.last_position_at) : null,
    gpsSource: row.gps_source,
    companyId: row.company_id,
    trackingToken: row.tracking_token,
    createdAt: new Date(row.created_at),
  };
}
function hydrateEvent(row: RawEvent): DeliveryEventRow {
  return { deliveryId: row.delivery_id, type: row.type, progress: Number(row.progress), createdAt: new Date(row.created_at) };
}
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

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS deliveries (
      id text PRIMARY KEY,
      customer text NOT NULL,
      origin_site_id text,
      origin_latitude double precision,
      origin_longitude double precision,
      destination_site_id text,
      destination text NOT NULL,
      destination_latitude double precision,
      destination_longitude double precision,
      arrival_radius_km double precision NOT NULL DEFAULT 0.5,
      truck text NOT NULL,
      driver text NOT NULL,
      status text NOT NULL,
      eta text NOT NULL,
      planned_arrival_at timestamptz,
      progress integer NOT NULL DEFAULT 0,
      color text NOT NULL DEFAULT '#916ed7',
      contact text NOT NULL DEFAULT '',
      sendatrack_vehicle_id text NOT NULL DEFAULT '',
      latitude double precision,
      longitude double precision,
      speed double precision,
      last_position_at timestamptz,
      gps_source text NOT NULL DEFAULT 'simulation',
      company_id text NOT NULL DEFAULT 'demo',
      tracking_token text UNIQUE,
      created_at timestamptz NOT NULL
    )`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_site_id text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_latitude double precision`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_longitude double precision`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS destination_site_id text`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)`;
    await sql`CREATE TABLE IF NOT EXISTS delivery_events (
      delivery_id text NOT NULL,
      type text NOT NULL,
      progress integer NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (delivery_id, type)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events(delivery_id)`;
    await sql`CREATE TABLE IF NOT EXISTS delivery_notifications (
      delivery_id text NOT NULL,
      event_type text NOT NULL,
      channel text NOT NULL,
      attempted_at timestamptz NOT NULL,
      sent_at timestamptz,
      PRIMARY KEY (delivery_id, event_type, channel)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS delivery_eta_observations (
      delivery_id text NOT NULL,
      position_at timestamptz NOT NULL,
      estimated_arrival_at timestamptz NOT NULL,
      planned_arrival_at timestamptz,
      delay_minutes integer,
      effective_speed_kmh double precision,
      remaining_distance_km double precision NOT NULL,
      progress integer NOT NULL,
      confidence text NOT NULL,
      source text NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (delivery_id, position_at)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eta_observations_delivery_position ON delivery_eta_observations(delivery_id, position_at DESC)`;
    await sql`ALTER TABLE delivery_eta_observations ADD COLUMN IF NOT EXISTS route_template_id text`;
    await sql`ALTER TABLE delivery_eta_observations ADD COLUMN IF NOT EXISTS trip_instance_id text`;
    await sql`ALTER TABLE delivery_eta_observations ADD COLUMN IF NOT EXISTS destination_site_id text`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eta_observations_route_destination ON delivery_eta_observations(route_template_id, destination_site_id, position_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS trip_position_observations (
      company_id text NOT NULL,
      route_template_id text NOT NULL,
      trip_instance_id text NOT NULL,
      vehicle_id text NOT NULL,
      position_at timestamptz NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      speed double precision NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (company_id, trip_instance_id, position_at)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_trip_positions_company_route ON trip_position_observations(company_id, route_template_id, position_at DESC)`;

    for (const delivery of seedDeliveries) {
      await sql`INSERT INTO deliveries (
        id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
        truck, driver, status, eta, planned_arrival_at, progress, color, contact, sendatrack_vehicle_id,
        latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at
      ) VALUES (
        ${delivery.id}, ${delivery.customer}, ${delivery.originSiteId}, ${delivery.originLatitude}, ${delivery.originLongitude}, ${delivery.destinationSiteId}, ${delivery.destination}, ${delivery.destinationLatitude}, ${delivery.destinationLongitude}, ${delivery.arrivalRadiusKm},
        ${delivery.truck}, ${delivery.driver}, ${delivery.status}, ${delivery.eta}, ${delivery.plannedArrivalAt?.toISOString() ?? null}, ${delivery.progress}, ${delivery.color}, ${delivery.contact}, ${delivery.sendatrackVehicleId},
        ${delivery.latitude}, ${delivery.longitude}, ${delivery.speed}, ${delivery.lastPositionAt?.toISOString() ?? null}, ${delivery.gpsSource}, ${delivery.companyId}, ${delivery.trackingToken}, ${delivery.createdAt.toISOString()}
      ) ON CONFLICT (id) DO NOTHING`;
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function baselineProgress(deliveryId: string) {
  const rows = await sql`SELECT progress FROM delivery_events WHERE delivery_id = ${deliveryId} AND type = 'GPS_BASELINE' LIMIT 1` as Array<{ progress: number }>;
  return rows[0] ? Number(rows[0].progress) : 0;
}

export const postgresStore: DeliveryStore = {
  async getPublic(tracking) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM deliveries WHERE tracking_token = ${tracking} LIMIT 1` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async listForCompany(companyId) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM deliveries WHERE company_id = ${companyId} ORDER BY created_at DESC` as RawDelivery[];
    return rows.map(hydrate);
  },

  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    await ensureSchema();
    const rows = await sql`SELECT * FROM deliveries WHERE company_id = ${companyId} AND status <> 'Delivered'` as RawDelivery[];

    for (const raw of rows) {
      const delivery = hydrate(raw);
      const match = matchDeliveryVehicle(delivery, snapshot.vehicles);
      const vehicle = match.vehicle;
      if (!vehicle) continue;

      const firstLink = !delivery.sendatrackVehicleId && delivery.gpsSource !== "sendatrack";
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const origin = explicitOrigin(delivery);
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), origin);
      if (firstLink) {
        await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at) VALUES (${delivery.id}, 'GPS_BASELINE', ${absoluteMetrics.progress}, ${new Date().toISOString()}) ON CONFLICT (delivery_id, type) DO NOTHING`;
      }
      const metrics = rebaseRouteMetrics(absoluteMetrics, origin ? 0 : await baselineProgress(delivery.id));
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const state = firstLink ? { status: "Loading" as const, progress: previousProgress } : deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress, delivery.arrivalRadiusKm, positionAgeMinutes);
      const events = firstLink ? [] : detectDeliveryEvents({
        previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes,
      });

      await sql`UPDATE deliveries SET
        sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, latitude = ${vehicle.latitude}, longitude = ${vehicle.longitude},
        speed = ${vehicle.speed}, last_position_at = ${new Date(vehicle.updatedAt).toISOString()}, gps_source = 'sendatrack',
        progress = ${state.progress}, status = ${state.status}
        WHERE id = ${delivery.id}`;

      transitions.push({
        delivery: {
          ...delivery,
          sendatrackVehicleId: vehicle.id,
          truck: vehicle.name,
          latitude: vehicle.latitude,
          longitude: vehicle.longitude,
          speed: vehicle.speed,
          lastPositionAt: new Date(vehicle.updatedAt),
          gpsSource: "sendatrack",
          progress: state.progress,
          status: state.status,
        },
        events,
      });
    }
    return transitions;
  },

  async linkVehicle(deliveryId, companyId, vehicle) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered' LIMIT 1` as RawDelivery[];
    const delivery = rows[0] ? hydrate(rows[0]) : null;
    if (!delivery) return null;
    const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), explicitOrigin(delivery));
    await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at) VALUES (${delivery.id}, 'GPS_BASELINE', ${metrics.progress}, ${new Date().toISOString()}) ON CONFLICT (delivery_id, type) DO NOTHING`;
    await sql`UPDATE deliveries SET
      sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, latitude = ${vehicle.latitude}, longitude = ${vehicle.longitude},
      speed = ${vehicle.speed}, last_position_at = ${new Date(vehicle.updatedAt).toISOString()}, gps_source = 'sendatrack', status = 'Loading'
      WHERE id = ${delivery.id} AND company_id = ${companyId}`;
    const updated = await sql`SELECT * FROM deliveries WHERE id = ${delivery.id} AND company_id = ${companyId} LIMIT 1` as RawDelivery[];
    return updated[0] ? hydrate(updated[0]) : null;
  },
  async recordEvent(deliveryId, type, progress) {
    await ensureSchema();
    const rows = await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      VALUES (${deliveryId}, ${type}, ${progress}, ${new Date().toISOString()})
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id` as Array<{ delivery_id: string }>;
    return rows.length > 0;
  },

  async listEvents(deliveryId) {
    await ensureSchema();
    const rows = await sql`SELECT delivery_id, type, progress, created_at FROM delivery_events WHERE delivery_id = ${deliveryId} ORDER BY created_at ASC` as RawEvent[];
    return rows.map(hydrateEvent);
  },

  async recordEtaObservation(input) {
    await ensureSchema();
    const rows = await sql`INSERT INTO delivery_eta_observations (
      delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
    ) VALUES (
      ${input.deliveryId}, ${input.routeTemplateId}, ${input.tripInstanceId}, ${input.destinationSiteId}, ${input.positionAt.toISOString()}, ${input.estimatedArrivalAt.toISOString()}, ${input.plannedArrivalAt?.toISOString() ?? null}, ${input.delayMinutes}, ${input.effectiveSpeedKmh}, ${input.remainingDistanceKm}, ${input.progress}, ${input.confidence}, ${input.source}, ${new Date().toISOString()}
    ) ON CONFLICT (delivery_id, position_at) DO NOTHING RETURNING delivery_id` as Array<{ delivery_id: string }>;
    return rows.length > 0;
  },

  async listEtaObservations(deliveryId, limit = 200) {
    await ensureSchema();
    const capped = Math.max(1, Math.min(2000, Math.round(limit)));
    const rows = await sql`SELECT delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
      FROM delivery_eta_observations WHERE delivery_id = ${deliveryId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      deliveryId: String(row.delivery_id), routeTemplateId: row.route_template_id ? String(row.route_template_id) : null, tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null, destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
      positionAt: new Date(String(row.position_at)), estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
      plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null, delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
      effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh), remainingDistanceKm: Number(row.remaining_distance_km), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(String(row.created_at)),
    }));
  },
  async listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit = 5000) {
    await ensureSchema();
    const capped = Math.max(1, Math.min(10000, Math.round(limit)));
    const rows = await sql`SELECT delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
      FROM delivery_eta_observations WHERE route_template_id = ${routeTemplateId} AND destination_site_id = ${destinationSiteId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      deliveryId: String(row.delivery_id), routeTemplateId: row.route_template_id ? String(row.route_template_id) : null, tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null, destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
      positionAt: new Date(String(row.position_at)), estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
      plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null, delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
      effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh), remainingDistanceKm: Number(row.remaining_distance_km), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(String(row.created_at)),
    }));
  },

  async recordTripPosition(input) {
    await ensureSchema();
    const rows = await sql`INSERT INTO trip_position_observations (company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at)
      VALUES (${input.companyId}, ${input.routeTemplateId}, ${input.tripInstanceId}, ${input.vehicleId}, ${input.positionAt.toISOString()}, ${input.latitude}, ${input.longitude}, ${input.speed}, ${new Date().toISOString()})
      ON CONFLICT (company_id, trip_instance_id, position_at) DO NOTHING RETURNING trip_instance_id` as Array<{ trip_instance_id: string }>;
    return rows.length > 0;
  },
  async listTripPositionsForRoute(companyId, routeTemplateId, limit = 10000) {
    await ensureSchema();
    const capped = Math.max(1, Math.min(20000, Math.round(limit)));
    const rows = await sql`SELECT company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
      FROM trip_position_observations WHERE company_id = ${companyId} AND route_template_id = ${routeTemplateId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      companyId: String(row.company_id), routeTemplateId: String(row.route_template_id), tripInstanceId: String(row.trip_instance_id), vehicleId: String(row.vehicle_id),
      positionAt: new Date(String(row.position_at)), latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), createdAt: new Date(String(row.created_at)),
    }));
  },

  async listPendingNotifications(companyId) {
    await ensureSchema();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const rows = await sql`SELECT e.delivery_id, e.type, e.progress, e.created_at
      FROM delivery_events e
      JOIN deliveries d ON d.id = e.delivery_id
      LEFT JOIN delivery_notifications n ON n.delivery_id = e.delivery_id AND n.event_type = e.type AND n.channel = 'whatsapp'
      WHERE d.company_id = ${companyId}
        AND n.sent_at IS NULL
        AND (n.attempted_at IS NULL OR n.attempted_at < ${staleBefore})
      ORDER BY e.created_at ASC` as RawEvent[];
    const pending = [];
    for (const raw of rows) {
      const event = hydrateEvent(raw);
      if (!customerFacingEvent(event.type)) continue;
      const deliveryRows = await sql`SELECT * FROM deliveries WHERE id = ${event.deliveryId} LIMIT 1` as RawDelivery[];
      if (deliveryRows[0]) pending.push({ delivery: hydrate(deliveryRows[0]), event });
    }
    return pending;
  },

  async claimNotification(deliveryId, type) {
    await ensureSchema();
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const inserted = await sql`INSERT INTO delivery_notifications (delivery_id, event_type, channel, attempted_at, sent_at)
      VALUES (${deliveryId}, ${type}, 'whatsapp', ${now}, NULL)
      ON CONFLICT (delivery_id, event_type, channel) DO NOTHING
      RETURNING delivery_id` as Array<{ delivery_id: string }>;
    if (inserted.length) return true;
    const reclaimed = await sql`UPDATE delivery_notifications SET attempted_at = ${now}
      WHERE delivery_id = ${deliveryId} AND event_type = ${type} AND channel = 'whatsapp'
        AND sent_at IS NULL AND attempted_at < ${staleBefore}
      RETURNING delivery_id` as Array<{ delivery_id: string }>;
    return reclaimed.length > 0;
  },

  async markNotificationSent(deliveryId, type) {
    await ensureSchema();
    await sql`UPDATE delivery_notifications SET sent_at = ${new Date().toISOString()}
      WHERE delivery_id = ${deliveryId} AND event_type = ${type} AND channel = 'whatsapp'`;
  },

  async releaseNotification(deliveryId, type) {
    await ensureSchema();
    await sql`DELETE FROM delivery_notifications
      WHERE delivery_id = ${deliveryId} AND event_type = ${type} AND channel = 'whatsapp' AND sent_at IS NULL`;
  },

  async create(input: CreateDeliveryInput) {
    await ensureSchema();
    const delivery: DeliveryRow = { ...input, id: `TF-${String(Date.now()).slice(-6)}`, createdAt: new Date() };
    await sql`INSERT INTO deliveries (
      id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
      truck, driver, status, eta, planned_arrival_at, progress, color, contact, sendatrack_vehicle_id,
      latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at
    ) VALUES (
      ${delivery.id}, ${delivery.customer}, ${delivery.originSiteId}, ${delivery.originLatitude}, ${delivery.originLongitude}, ${delivery.destinationSiteId}, ${delivery.destination}, ${delivery.destinationLatitude}, ${delivery.destinationLongitude}, ${delivery.arrivalRadiusKm},
      ${delivery.truck}, ${delivery.driver}, ${delivery.status}, ${delivery.eta}, ${delivery.plannedArrivalAt?.toISOString() ?? null}, ${delivery.progress}, ${delivery.color}, ${delivery.contact}, ${delivery.sendatrackVehicleId},
      ${delivery.latitude}, ${delivery.longitude}, ${delivery.speed}, ${delivery.lastPositionAt?.toISOString() ?? null}, ${delivery.gpsSource}, ${delivery.companyId}, ${delivery.trackingToken}, ${delivery.createdAt.toISOString()}
    )`;
    return delivery;
  },
};