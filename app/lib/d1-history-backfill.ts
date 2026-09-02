import { getSqlOrNull } from "./pg-client.ts";
import { runtimeEnv } from "trackfleet-runtime-env";
import type { DeliveryEventRow, DeliveryRow, DeliveryStatus, EtaObservationRow } from "./delivery-store.types";
import type { DeliveryEventType } from "./delivery-events";

const maxCompaniesPerPass = 3;
const pageSize = 10;
const maxEtaPerDelivery = 10;
const d1BatchSize = 50;
const maxD1StatementsPerCompanyPage = 800;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
};

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
  next_truck_departure_at: string | Date | null;
  progress: number | string;
  color: string;
  contact: string;
  recipient_name: string | null;
  recipient_contact: string | null;
  weight_kg: number | string | null;
  price_amount: number | string | null;
  price_currency: "EUR" | "MAD" | null;
  item_description: string | null;
  customer_email: string | null;
  whatsapp_opt_in: boolean | null;
  whatsapp_opt_in_at: string | Date | null;
  recipient_whatsapp_opt_in: boolean | null;
  recipient_whatsapp_opt_in_at: string | Date | null;
  sendatrack_vehicle_id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  speed: number | string | null;
  last_position_at: string | Date | null;
  gps_source: string;
  company_id: string;
  tracking_token: string | null;
  trip_id: string | null;
  shipment_id: string | null;
  created_at: string | Date;
  parcel_code: string | null;
  short_code: string | null;
  payment_status: "unpaid" | "partial" | "paid" | null;
  amount_paid: number | string | null;
};

type RawEvent = {
  delivery_id: string;
  type: string;
  progress: number | string;
  created_at: string | Date;
};

type RawEta = Record<string, unknown> & { delivery_id: string };

type BackfillState = {
  cursor_created_at: number | null;
  cursor_id: string | null;
  completed_at: number | null;
};

export type D1HistoryBackfillResult = {
  ran: boolean;
  reason: "ok" | "d1_not_bound" | "postgres_not_configured";
  companies: number;
  completedCompanies: number;
  deliveries: number;
  events: number;
  etaObservations: number;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1Binding }).DB ?? null;
}

function numberOrNull(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hydrateDelivery(row: RawDelivery): DeliveryRow {
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
    nextTruckDepartureAt: row.next_truck_departure_at ? new Date(row.next_truck_departure_at) : null,
    progress: Number(row.progress),
    color: row.color,
    contact: row.contact,
    recipientName: row.recipient_name ?? "",
    recipientContact: row.recipient_contact ?? "",
    weightKg: numberOrNull(row.weight_kg),
    priceAmount: numberOrNull(row.price_amount),
    priceCurrency: row.price_currency === "EUR" || row.price_currency === "MAD" ? row.price_currency : null,
    itemDescription: row.item_description ?? null,
    customerEmail: row.customer_email ?? null,
    whatsappOptIn: row.whatsapp_opt_in === true,
    whatsappOptInAt: row.whatsapp_opt_in_at ? new Date(row.whatsapp_opt_in_at) : null,
    recipientWhatsappOptIn: row.recipient_whatsapp_opt_in === true,
    recipientWhatsappOptInAt: row.recipient_whatsapp_opt_in_at ? new Date(row.recipient_whatsapp_opt_in_at) : null,
    sendatrackVehicleId: row.sendatrack_vehicle_id,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    speed: numberOrNull(row.speed),
    lastPositionAt: row.last_position_at ? new Date(row.last_position_at) : null,
    gpsSource: row.gps_source,
    companyId: row.company_id,
    trackingToken: row.tracking_token,
    tripId: row.trip_id ?? null,
    shipmentId: row.shipment_id ?? null,
    createdAt: new Date(row.created_at),
    parcelCode: row.parcel_code ?? null,
    shortCode: row.short_code ?? null,
    paymentStatus: row.payment_status ?? null,
    amountPaid: numberOrNull(row.amount_paid),
  };
}

function hydrateEvent(row: RawEvent): DeliveryEventRow {
  return {
    deliveryId: row.delivery_id,
    type: row.type as DeliveryEventType,
    progress: Number(row.progress),
    createdAt: new Date(row.created_at),
  };
}

function hydrateEta(row: RawEta): EtaObservationRow {
  return {
    deliveryId: String(row.delivery_id),
    companyId: row.company_id ? String(row.company_id) : "",
    routeTemplateId: row.route_template_id ? String(row.route_template_id) : null,
    tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null,
    destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
    positionAt: new Date(String(row.position_at)),
    estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
    plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null,
    delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
    effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh),
    remainingDistanceKm: Number(row.remaining_distance_km),
    progress: Number(row.progress),
    confidence: String(row.confidence) as EtaObservationRow["confidence"],
    source: String(row.source) as EtaObservationRow["source"],
    createdAt: new Date(String(row.created_at)),
  };
}

function deliveryStatement(db: D1Binding, delivery: DeliveryRow) {
  return db.prepare(`INSERT INTO deliveries (
    id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination,
    destination_latitude, destination_longitude, arrival_radius_km, truck, driver, status, eta,
    planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, customer_email, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at,
    sendatrack_vehicle_id, latitude, longitude, speed, last_position_at, gps_source, company_id,
    tracking_token, trip_id, shipment_id, created_at, parcel_code, short_code, payment_status, amount_paid
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    customer = excluded.customer,
    origin_site_id = excluded.origin_site_id,
    origin_latitude = excluded.origin_latitude,
    origin_longitude = excluded.origin_longitude,
    destination_site_id = excluded.destination_site_id,
    destination = excluded.destination,
    destination_latitude = excluded.destination_latitude,
    destination_longitude = excluded.destination_longitude,
    arrival_radius_km = excluded.arrival_radius_km,
    truck = excluded.truck,
    driver = excluded.driver,
    status = excluded.status,
    eta = excluded.eta,
    planned_arrival_at = excluded.planned_arrival_at,
    next_truck_departure_at = excluded.next_truck_departure_at,
    progress = excluded.progress,
    color = excluded.color,
    contact = excluded.contact,
    recipient_name = excluded.recipient_name,
    recipient_contact = excluded.recipient_contact,
    weight_kg = excluded.weight_kg,
    price_amount = excluded.price_amount,
    price_currency = excluded.price_currency,
    item_description = excluded.item_description,
    customer_email = excluded.customer_email,
    whatsapp_opt_in = excluded.whatsapp_opt_in,
    whatsapp_opt_in_at = excluded.whatsapp_opt_in_at,
    recipient_whatsapp_opt_in = excluded.recipient_whatsapp_opt_in,
    recipient_whatsapp_opt_in_at = excluded.recipient_whatsapp_opt_in_at,
    sendatrack_vehicle_id = excluded.sendatrack_vehicle_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    speed = excluded.speed,
    last_position_at = excluded.last_position_at,
    gps_source = excluded.gps_source,
    company_id = excluded.company_id,
    tracking_token = excluded.tracking_token,
    trip_id = excluded.trip_id,
    shipment_id = excluded.shipment_id,
    parcel_code = excluded.parcel_code,
    short_code = excluded.short_code,
    payment_status = excluded.payment_status,
    amount_paid = excluded.amount_paid`)
    .bind(
      delivery.id, delivery.customer, delivery.originSiteId, delivery.originLatitude, delivery.originLongitude,
      delivery.destinationSiteId, delivery.destination, delivery.destinationLatitude, delivery.destinationLongitude,
      delivery.arrivalRadiusKm, delivery.truck, delivery.driver, delivery.status, delivery.eta,
      delivery.plannedArrivalAt?.getTime() ?? null, delivery.nextTruckDepartureAt?.getTime() ?? null, delivery.progress, delivery.color, delivery.contact, delivery.recipientName ?? "", delivery.recipientContact ?? "",
      delivery.weightKg ?? null, delivery.priceAmount ?? null, delivery.priceCurrency ?? null, delivery.itemDescription ?? null, delivery.customerEmail ?? null,
      delivery.whatsappOptIn ? 1 : 0, delivery.whatsappOptInAt?.getTime() ?? null, delivery.recipientWhatsappOptIn ? 1 : 0, delivery.recipientWhatsappOptInAt?.getTime() ?? null,
      delivery.sendatrackVehicleId, delivery.latitude, delivery.longitude, delivery.speed,
      delivery.lastPositionAt?.getTime() ?? null, delivery.gpsSource, delivery.companyId,
      delivery.trackingToken, delivery.tripId ?? null, delivery.shipmentId ?? null, delivery.createdAt.getTime(), delivery.parcelCode ?? null, delivery.shortCode ?? null,
      delivery.paymentStatus ?? null, delivery.amountPaid ?? null,
    );
}

function eventStatement(db: D1Binding, event: DeliveryEventRow) {
  return db.prepare(`INSERT INTO delivery_events (delivery_id, type, progress, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(delivery_id, type) DO UPDATE SET progress = excluded.progress, created_at = excluded.created_at`)
    .bind(event.deliveryId, event.type, event.progress, event.createdAt.getTime());
}

function etaStatement(db: D1Binding, observation: EtaObservationRow) {
  return db.prepare(`INSERT INTO delivery_eta_observations (
    delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at,
    estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh,
    remaining_distance_km, progress, confidence, source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(delivery_id, position_at) DO UPDATE SET
    company_id = excluded.company_id,
    route_template_id = excluded.route_template_id,
    trip_instance_id = excluded.trip_instance_id,
    destination_site_id = excluded.destination_site_id,
    estimated_arrival_at = excluded.estimated_arrival_at,
    planned_arrival_at = excluded.planned_arrival_at,
    delay_minutes = excluded.delay_minutes,
    effective_speed_kmh = excluded.effective_speed_kmh,
    remaining_distance_km = excluded.remaining_distance_km,
    progress = excluded.progress,
    confidence = excluded.confidence,
    source = excluded.source,
    created_at = excluded.created_at`)
    .bind(
      observation.deliveryId, observation.companyId, observation.routeTemplateId, observation.tripInstanceId,
      observation.destinationSiteId, observation.positionAt.getTime(), observation.estimatedArrivalAt.getTime(),
      observation.plannedArrivalAt?.getTime() ?? null, observation.delayMinutes, observation.effectiveSpeedKmh,
      observation.remainingDistanceKm, observation.progress, observation.confidence, observation.source,
      observation.createdAt.getTime(),
    );
}

async function runBatches(db: D1Binding, statements: D1Statement[]) {
  if (statements.length > maxD1StatementsPerCompanyPage) throw new Error("d1_history_backfill_budget_exceeded");
  for (let index = 0; index < statements.length; index += d1BatchSize) {
    await db.batch(statements.slice(index, index + d1BatchSize));
  }
}

async function stateForCompany(db: D1Binding, companyId: string) {
  return db.prepare(`SELECT cursor_created_at, cursor_id, completed_at
    FROM d1_history_backfill_state WHERE company_id = ? LIMIT 1`)
    .bind(companyId)
    .first<BackfillState>();
}

async function saveProgress(db: D1Binding, companyId: string, cursor: { createdAt: number; id: string } | null, completed: boolean) {
  const now = Date.now();
  await db.prepare(`INSERT INTO d1_history_backfill_state (
      company_id, cursor_created_at, cursor_id, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      cursor_created_at = excluded.cursor_created_at,
      cursor_id = excluded.cursor_id,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at`)
    .bind(companyId, cursor?.createdAt ?? null, cursor?.id ?? null, completed ? now : null, now)
    .run();
}

export async function backfillD1DeliveryHistory(): Promise<D1HistoryBackfillResult> {
  const db = d1();
  if (!db) return { ran: false, reason: "d1_not_bound", companies: 0, completedCompanies: 0, deliveries: 0, events: 0, etaObservations: 0 };
  const sql = getSqlOrNull();
  if (!sql) return { ran: false, reason: "postgres_not_configured", companies: 0, completedCompanies: 0, deliveries: 0, events: 0, etaObservations: 0 };

  const companies = await sql`SELECT company_id AS id
    FROM deliveries WHERE company_id IS NOT NULL AND company_id <> ''
    GROUP BY company_id ORDER BY MAX(created_at) DESC LIMIT ${maxCompaniesPerPass}` as Array<{ id: string }>;

  let deliveriesCount = 0;
  let eventsCount = 0;
  let etaCount = 0;
  let completedCompanies = 0;

  for (const { id: companyId } of companies) {
    const state = await stateForCompany(db, companyId);
    if (state?.completed_at) {
      completedCompanies += 1;
      continue;
    }

    const cursorCreatedAt = state?.cursor_created_at ? new Date(state.cursor_created_at).toISOString() : null;
    const cursorId = state?.cursor_id ?? null;
    const rows = cursorCreatedAt && cursorId
      ? await sql`SELECT * FROM deliveries
          WHERE company_id = ${companyId} AND status = 'Delivered'
            AND (created_at < ${cursorCreatedAt} OR (created_at = ${cursorCreatedAt} AND id < ${cursorId}))
          ORDER BY created_at DESC, id DESC LIMIT ${pageSize + 1}` as RawDelivery[]
      : await sql`SELECT * FROM deliveries
          WHERE company_id = ${companyId} AND status = 'Delivered'
          ORDER BY created_at DESC, id DESC LIMIT ${pageSize + 1}` as RawDelivery[];

    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    if (!pageRows.length) {
      await saveProgress(db, companyId, null, true);
      completedCompanies += 1;
      continue;
    }

    const deliveries = pageRows.map(hydrateDelivery);
    const ids = deliveries.map((delivery) => delivery.id);
    const [eventRows, etaRows] = await Promise.all([
      sql`SELECT delivery_id, type, progress, created_at FROM delivery_events
        WHERE delivery_id = ANY(${ids}::text[]) ORDER BY delivery_id, created_at ASC`
        .then((result) => result as unknown as RawEvent[]),
      sql`SELECT delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id,
          position_at, estimated_arrival_at, planned_arrival_at, delay_minutes,
          effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
        FROM (
          SELECT observation.*,
            row_number() OVER (PARTITION BY delivery_id ORDER BY position_at DESC) AS row_number
          FROM delivery_eta_observations observation
          WHERE delivery_id = ANY(${ids}::text[])
        ) ranked
        WHERE row_number <= ${maxEtaPerDelivery}
        ORDER BY delivery_id, position_at DESC`
        .then((result) => result as unknown as RawEta[]),
    ]);

    const events = eventRows.map(hydrateEvent);
    const eta = etaRows.map(hydrateEta);
    const statements: D1Statement[] = [
      ...deliveries.map((delivery) => deliveryStatement(db, delivery)),
      ...events.map((event) => eventStatement(db, event)),
      ...eta.map((observation) => etaStatement(db, observation)),
    ];
    await runBatches(db, statements);

    deliveriesCount += deliveries.length;
    eventsCount += events.length;
    etaCount += eta.length;
    const last = deliveries.at(-1)!;
    await saveProgress(db, companyId, hasMore ? { createdAt: last.createdAt.getTime(), id: last.id } : null, !hasMore);
    if (!hasMore) completedCompanies += 1;
  }

  return {
    ran: true,
    reason: "ok",
    companies: companies.length,
    completedCompanies,
    deliveries: deliveriesCount,
    events: eventsCount,
    etaObservations: etaCount,
  };
}
