import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";
import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import type { DeliveryEventRow, DeliveryRow, EtaObservationRow } from "./delivery-store.types";
import type { CompanySite } from "./site-store.types";
import type { TripRecord } from "./trip-record";

const maxCompanies = 5;
const maxTripsPerCompany = 100;
const maxEtaPerDelivery = 20;
const d1BatchSize = 50;
const maxActiveSessions = 200;
const maxD1StatementsPerPass = 1000;

export type D1ReconciliationResult = {
  ran: boolean;
  reason: "ok" | "d1_not_bound" | "postgres_not_configured";
  companies: number;
  deliveries: number;
  events: number;
  etaObservations: number;
  sites: number;
  trips: number;
  sessions: number;
};

type D1Statement = { bind(...values: unknown[]): D1Statement; run(): Promise<unknown> };
type D1Binding = { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown> };
type SessionRow = { token_hash: string; company_id: string; account_label: string | null; user_label: string | null; credentials_ciphertext: string | null; expires_at: string | Date; created_at: string | Date };

function d1() { return (runtimeEnv as unknown as { DB?: D1Binding }).DB ?? null; }
function databaseUrl() { return runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ""; }

function deliveryStatement(db: D1Binding, delivery: DeliveryRow) {
  return db.prepare(`INSERT INTO deliveries (
    id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination,
    destination_latitude, destination_longitude, arrival_radius_km, truck, driver, status, eta,
    planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at,
    sendatrack_vehicle_id, latitude, longitude, speed, last_position_at, gps_source, company_id,
    tracking_token, trip_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    customer = excluded.customer, origin_site_id = excluded.origin_site_id, origin_latitude = excluded.origin_latitude,
    origin_longitude = excluded.origin_longitude, destination_site_id = excluded.destination_site_id, destination = excluded.destination,
    destination_latitude = excluded.destination_latitude, destination_longitude = excluded.destination_longitude,
    arrival_radius_km = excluded.arrival_radius_km, truck = excluded.truck, driver = excluded.driver, status = excluded.status,
    eta = excluded.eta, planned_arrival_at = excluded.planned_arrival_at, next_truck_departure_at = excluded.next_truck_departure_at, progress = excluded.progress, color = excluded.color,
    contact = excluded.contact, recipient_name = excluded.recipient_name, recipient_contact = excluded.recipient_contact, weight_kg = excluded.weight_kg, price_amount = excluded.price_amount, price_currency = excluded.price_currency,
    whatsapp_opt_in = excluded.whatsapp_opt_in, whatsapp_opt_in_at = excluded.whatsapp_opt_in_at, recipient_whatsapp_opt_in = excluded.recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at = excluded.recipient_whatsapp_opt_in_at,
    sendatrack_vehicle_id = excluded.sendatrack_vehicle_id, latitude = excluded.latitude, longitude = excluded.longitude,
    speed = excluded.speed, last_position_at = excluded.last_position_at, gps_source = excluded.gps_source,
    company_id = excluded.company_id, tracking_token = excluded.tracking_token, trip_id = excluded.trip_id`)
    .bind(delivery.id, delivery.customer, delivery.originSiteId, delivery.originLatitude, delivery.originLongitude,
      delivery.destinationSiteId, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude,
      delivery.arrivalRadiusKm, delivery.truck, delivery.driver, delivery.status, delivery.eta,
      delivery.plannedArrivalAt?.getTime() ?? null, delivery.nextTruckDepartureAt?.getTime() ?? null, delivery.progress, delivery.color, delivery.contact, delivery.recipientName ?? "", delivery.recipientContact ?? "",
      delivery.weightKg ?? null, delivery.priceAmount ?? null, delivery.priceCurrency ?? null,
      delivery.whatsappOptIn === true ? 1 : 0, delivery.whatsappOptInAt?.getTime() ?? null, delivery.recipientWhatsappOptIn === true ? 1 : 0, delivery.recipientWhatsappOptInAt?.getTime() ?? null,
      delivery.sendatrackVehicleId, delivery.latitude, delivery.longitude, delivery.speed,
      delivery.lastPositionAt?.getTime() ?? null, delivery.gpsSource, delivery.companyId, delivery.trackingToken,
      delivery.tripId ?? null, delivery.createdAt.getTime());
}

function eventStatement(db: D1Binding, event: DeliveryEventRow) {
  return db.prepare(`INSERT INTO delivery_events (delivery_id, type, progress, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(delivery_id, type) DO UPDATE SET progress = excluded.progress, created_at = excluded.created_at`)
    .bind(event.deliveryId, event.type, event.progress, event.createdAt.getTime());
}

function etaStatement(db: D1Binding, observation: EtaObservationRow) {
  return db.prepare(`INSERT INTO delivery_eta_observations (
    delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at,
    planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(delivery_id, position_at) DO UPDATE SET route_template_id = excluded.route_template_id,
    trip_instance_id = excluded.trip_instance_id, destination_site_id = excluded.destination_site_id,
    estimated_arrival_at = excluded.estimated_arrival_at, planned_arrival_at = excluded.planned_arrival_at,
    delay_minutes = excluded.delay_minutes, effective_speed_kmh = excluded.effective_speed_kmh,
    remaining_distance_km = excluded.remaining_distance_km, progress = excluded.progress,
    confidence = excluded.confidence, source = excluded.source, created_at = excluded.created_at`)
    .bind(observation.deliveryId, observation.routeTemplateId, observation.tripInstanceId, observation.destinationSiteId,
      observation.positionAt.getTime(), observation.estimatedArrivalAt.getTime(), observation.plannedArrivalAt?.getTime() ?? null,
      observation.delayMinutes, observation.effectiveSpeedKmh, observation.remainingDistanceKm, observation.progress,
      observation.confidence, observation.source, observation.createdAt.getTime());
}

function siteStatement(db: D1Binding, site: CompanySite) {
  return db.prepare(`INSERT INTO sites (company_id, id, label, city, country, address, latitude, longitude, arrival_radius_km, roles, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, id) DO UPDATE SET label = excluded.label, city = excluded.city, country = excluded.country,
      address = excluded.address, latitude = excluded.latitude, longitude = excluded.longitude,
      arrival_radius_km = excluded.arrival_radius_km, roles = excluded.roles, updated_at = excluded.updated_at`)
    .bind(site.companyId, site.id, site.label, site.city, site.country, site.address, site.latitude, site.longitude,
      site.arrivalRadiusKm, JSON.stringify(site.roles), site.createdAt.getTime(), site.updatedAt.getTime());
}

function tripStatement(db: D1Binding, trip: TripRecord) {
  const stopsJson = JSON.stringify(trip.stops.map((stop) => ({ ...stop, plannedArrivalAt: stop.plannedArrivalAt?.getTime() ?? null })));
  return db.prepare(`INSERT INTO trips (id, company_id, route_template_id, vehicle_key, truck, sendatrack_vehicle_id, origin_site_id, stops_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, id) DO UPDATE SET route_template_id = excluded.route_template_id, vehicle_key = excluded.vehicle_key,
      truck = excluded.truck, sendatrack_vehicle_id = excluded.sendatrack_vehicle_id, origin_site_id = excluded.origin_site_id,
      stops_json = excluded.stops_json, status = excluded.status, updated_at = excluded.updated_at`)
    .bind(trip.id, trip.companyId, trip.routeTemplateId, trip.vehicleKey, trip.truck, trip.sendatrackVehicleId,
      trip.originSiteId, stopsJson, trip.status, trip.createdAt.getTime(), trip.updatedAt.getTime());
}

function sessionStatement(db: D1Binding, session: SessionRow) {
  return db.prepare(`INSERT INTO sessions (token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET company_id = excluded.company_id,
      account_label = excluded.account_label, user_label = excluded.user_label, credentials_ciphertext = excluded.credentials_ciphertext,
      expires_at = excluded.expires_at`)
    .bind(session.token_hash, session.company_id, session.account_label, session.user_label, session.credentials_ciphertext,
      new Date(session.expires_at).getTime(), new Date(session.created_at).getTime());
}

async function runBatches(db: D1Binding, statements: D1Statement[]) {
  if (statements.length > maxD1StatementsPerPass) throw new Error("d1_reconciliation_budget_exceeded");
  for (let index = 0; index < statements.length; index += d1BatchSize) await db.batch(statements.slice(index, index + d1BatchSize));
}

export async function reconcileD1Standby(): Promise<D1ReconciliationResult> {
  const db = d1();
  if (!db) return { ran: false, reason: "d1_not_bound", companies: 0, deliveries: 0, events: 0, etaObservations: 0, sites: 0, trips: 0, sessions: 0 };
  const url = databaseUrl();
  if (!url) return { ran: false, reason: "postgres_not_configured", companies: 0, deliveries: 0, events: 0, etaObservations: 0, sites: 0, trips: 0, sessions: 0 };

  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at) VALUES ('d1_reconciliation', ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`).bind(now).run();

  const sql = neon(url);
  try {
    const companyRows = await sql`SELECT company_id AS id FROM deliveries WHERE company_id IS NOT NULL AND company_id <> ''
      GROUP BY company_id ORDER BY MAX(created_at) DESC LIMIT ${maxCompanies}` as Array<{ id: string }>;
    const companyIds = companyRows.map((row) => row.id);
    const sessionRows = await sql`SELECT token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at
      FROM sessions WHERE expires_at > NOW() ORDER BY expires_at DESC LIMIT ${maxActiveSessions}` as SessionRow[];

    let deliveriesCount = 0, eventsCount = 0, etaCount = 0, sitesCount = 0, tripsCount = 0;
    const statements: D1Statement[] = sessionRows.map((session) => sessionStatement(db, session));
    for (const companyId of companyIds) {
      const [deliveries, sites, trips] = await Promise.all([store.listForCompany(companyId), siteStore.listForCompany(companyId), store.listTrips(companyId, maxTripsPerCompany)]);
      const [eventGroups, etaGroups] = await Promise.all([
        Promise.all(deliveries.map((delivery) => store.listEvents(delivery.id))),
        Promise.all(deliveries.map((delivery) => store.listEtaObservations(delivery.id, maxEtaPerDelivery))),
      ]);
      deliveriesCount += deliveries.length; sitesCount += sites.length; tripsCount += trips.length;
      statements.push(...deliveries.map((delivery) => deliveryStatement(db, delivery)), ...sites.map((site) => siteStatement(db, site)), ...trips.map((trip) => tripStatement(db, trip)));
      for (const events of eventGroups) { eventsCount += events.length; statements.push(...events.map((event) => eventStatement(db, event))); }
      for (const observations of etaGroups) { etaCount += observations.length; statements.push(...observations.map((observation) => etaStatement(db, observation))); }
    }

    await runBatches(db, statements);
    await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at) VALUES ('d1_reconciliation', ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at`).bind(now, Date.now()).run();
    return { ran: true, reason: "ok", companies: companyIds.length, deliveries: deliveriesCount, events: eventsCount, etaObservations: etaCount, sites: sitesCount, trips: tripsCount, sessions: sessionRows.length };
  } catch (error) {
    try {
      await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at) VALUES ('d1_reconciliation', ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at`).bind(now, Date.now()).run();
    } catch (stateError) {
      console.error("[trackfleet:d1] failed to persist reconciliation failure state", {
        message: stateError instanceof Error ? stateError.message : "unknown_error",
      });
    }
    throw error;
  }
}
