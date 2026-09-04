import { getSql } from "./pg-client.ts";
import { progressRouteDestination } from "./delivery-progress-destination";
import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import { createDeliveryId } from "./delivery-id";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryScanCheckpoint, DeliveryScanRow, DeliveryScanSummary, DeliveryStatus, DeliveryStore, DeliveryTransition, EtaObservationRow } from "./delivery-store.types";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics, resolveGpsBaselineProgress } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";
import { matchDeliveryVehicle } from "./vehicle-linking";
import { UNASSIGNED_TRUCK } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "./demo-delivery";

let schemaPromise: Promise<void> | null = null;
const runtimeSchemaBootstrapEnabled = process.env.TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP === "true";

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
  progress: number;
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
  type: DeliveryEventType;
  progress: number;
  created_at: string | Date;
};

type RawPendingNotification = RawDelivery & {
  event_delivery_id: string;
  event_type: DeliveryEventType;
  event_progress: number;
  event_created_at: string | Date;
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
  return { deliveryId: row.delivery_id, type: row.type, progress: Number(row.progress), createdAt: new Date(row.created_at) };
}
function hydrateTrip(row: Record<string, unknown>): TripRecord {
  const rawStops = JSON.parse(String(row.stops_json)) as Array<{ siteId: string; destination: string; sequence: number; plannedArrivalAt: string | null }>;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    routeTemplateId: String(row.route_template_id),
    vehicleKey: String(row.vehicle_key),
    truck: String(row.truck),
    sendatrackVehicleId: String(row.sendatrack_vehicle_id ?? ""),
    originSiteId: row.origin_site_id ? String(row.origin_site_id) : null,
    stops: rawStops.map((stop) => ({ ...stop, plannedArrivalAt: stop.plannedArrivalAt ? new Date(stop.plannedArrivalAt) : null })),
    status: String(row.status) as TripRecord["status"],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
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
  // Production requests must never spend their external-subrequest budget on
  // schema creation/migration work. The legacy bootstrap remains available as
  // an explicit one-time escape hatch for controlled development databases.
  if (!runtimeSchemaBootstrapEnabled) return;
  if (schemaPromise) return schemaPromise;
  const sql = getSql();
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
      next_truck_departure_at timestamptz,
      progress integer NOT NULL DEFAULT 0,
      color text NOT NULL DEFAULT '#916ed7',
      contact text NOT NULL DEFAULT '',
      recipient_name text NOT NULL DEFAULT '',
      recipient_contact text NOT NULL DEFAULT '',
      weight_kg double precision,
      price_amount numeric(12,2),
      price_currency text,
      item_description text,
      customer_email text,
      whatsapp_opt_in boolean NOT NULL DEFAULT false,
      whatsapp_opt_in_at timestamptz,
      recipient_whatsapp_opt_in boolean NOT NULL DEFAULT false,
      recipient_whatsapp_opt_in_at timestamptz,
      sendatrack_vehicle_id text NOT NULL DEFAULT '',
      latitude double precision,
      longitude double precision,
      speed double precision,
      last_position_at timestamptz,
      gps_source text NOT NULL DEFAULT 'simulation',
      company_id text NOT NULL DEFAULT 'demo',
      tracking_token text UNIQUE,
      shipment_id text,
      created_at timestamptz NOT NULL,
      parcel_code text UNIQUE
    )`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_site_id text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_latitude double precision`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS origin_longitude double precision`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS destination_site_id text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS trip_id text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS recipient_name text NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS recipient_contact text NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS recipient_whatsapp_opt_in boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS recipient_whatsapp_opt_in_at timestamptz`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS weight_kg double precision`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price_amount numeric(12,2)`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price_currency text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS item_description text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS customer_email text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS next_truck_departure_at timestamptz`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS shipment_id text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS parcel_code text UNIQUE`;
    // Deliberately not UNIQUE: unlike parcel_code (a random string, global
    // uniqueness is just cheap extra safety), short_code is a deterministic
    // per-(company, prefix) sequence -- two different companies will
    // legitimately both hand out "CAS 00".
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS short_code text`;
    // Client asked: price stays fully editable, but whether it's actually
    // been collected is tracked separately. No column DEFAULT here on
    // purpose -- historical deliveries predate payment tracking entirely
    // and defaulting them all to "unpaid" would misrepresent parcels that
    // were, in reality, already paid. Every NEW delivery going forward
    // gets an explicit "unpaid" from create() below instead.
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_status text`;
    await sql`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deliveries_company_trip ON deliveries(company_id, trip_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deliveries_company_shipment ON deliveries(company_id, shipment_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_deliveries_company_parcel_code ON deliveries(company_id, parcel_code)`;
    await sql`CREATE TABLE IF NOT EXISTS delivery_scans (
      id text PRIMARY KEY,
      company_id text NOT NULL,
      delivery_id text NOT NULL,
      checkpoint text NOT NULL,
      scanned_by text NOT NULL,
      truck text,
      location_label text,
      scanned_at timestamptz NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_delivery_scans_delivery_id ON delivery_scans(delivery_id, scanned_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_delivery_scans_company_delivery_checkpoint ON delivery_scans(company_id, delivery_id, checkpoint, scanned_at DESC)`;
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
    // routeTemplateId is a hash of only the origin/destination site ids (see
    // route-template.ts), and the known-sites catalog is identical across
    // every company -- two unrelated companies shipping the same route get
    // the same routeTemplateId. Without company_id, listEtaObservationsForRoute
    // blended one company's real GPS-observed speed/delay history into
    // another's route-learning and ETA estimates. Backfilled from each
    // observation's own delivery, which already carries its company.
    await sql`ALTER TABLE delivery_eta_observations ADD COLUMN IF NOT EXISTS company_id text`;
    await sql`UPDATE delivery_eta_observations o SET company_id = d.company_id FROM deliveries d WHERE o.delivery_id = d.id AND o.company_id IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eta_observations_company_route_destination ON delivery_eta_observations(company_id, route_template_id, destination_site_id, position_at DESC)`;
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
    await sql`CREATE TABLE IF NOT EXISTS fleet_position_observations (
      company_id text NOT NULL,
      vehicle_id text NOT NULL,
      vehicle_name text NOT NULL,
      position_at timestamptz NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      speed double precision NOT NULL,
      heading double precision,
      address text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL,
      PRIMARY KEY (company_id, vehicle_id, position_at)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_positions_company_vehicle ON fleet_position_observations(company_id, vehicle_id, position_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS trips (
      id text NOT NULL,
      company_id text NOT NULL,
      route_template_id text NOT NULL,
      vehicle_key text NOT NULL,
      truck text NOT NULL,
      sendatrack_vehicle_id text NOT NULL DEFAULT '',
      origin_site_id text,
      stops_json text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (company_id, id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_trips_company_updated ON trips(company_id, updated_at DESC)`;
    // Backs assignShortCode below -- one lifetime, never-reset counter per
    // (company, destination prefix) pair, e.g. company X's "CAS" counter
    // hands out CAS 00, CAS 01, CAS 02... independent of every other
    // company's own CAS counter and every other prefix.
    await sql`CREATE TABLE IF NOT EXISTS delivery_code_counters (
      company_id text NOT NULL,
      prefix text NOT NULL,
      next_number integer NOT NULL,
      PRIMARY KEY (company_id, prefix)
    )`;

    for (const delivery of seedDeliveries) {
      await sql`INSERT INTO deliveries (
        id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
        truck, driver, status, eta, planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, customer_email, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at, sendatrack_vehicle_id,
        latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, created_at
      ) VALUES (
        ${delivery.id}, ${delivery.customer}, ${delivery.originSiteId}, ${delivery.originLatitude}, ${delivery.originLongitude}, ${delivery.destinationSiteId}, ${delivery.destination}, ${delivery.destinationLatitude}, ${delivery.destinationLongitude}, ${delivery.arrivalRadiusKm},
        ${delivery.truck}, ${delivery.driver}, ${delivery.status}, ${delivery.eta}, ${delivery.plannedArrivalAt?.toISOString() ?? null}, ${delivery.nextTruckDepartureAt?.toISOString() ?? null}, ${delivery.progress}, ${delivery.color}, ${delivery.contact}, ${delivery.recipientName ?? ""}, ${delivery.recipientContact ?? ""}, ${delivery.weightKg ?? null}, ${delivery.priceAmount ?? null}, ${delivery.priceCurrency ?? null}, ${delivery.itemDescription ?? null}, ${delivery.customerEmail ?? null}, ${delivery.whatsappOptIn === true}, ${delivery.whatsappOptInAt?.toISOString() ?? null}, ${delivery.recipientWhatsappOptIn === true}, ${delivery.recipientWhatsappOptInAt?.toISOString() ?? null}, ${delivery.sendatrackVehicleId},
        ${delivery.latitude}, ${delivery.longitude}, ${delivery.speed}, ${delivery.lastPositionAt?.toISOString() ?? null}, ${delivery.gpsSource}, ${delivery.companyId}, ${delivery.trackingToken}, ${delivery.createdAt.toISOString()}
      ) ON CONFLICT (id) DO NOTHING`;
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export const postgresStore: DeliveryStore = {
  async getPublic(tracking) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE tracking_token = ${tracking} LIMIT 1` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async listForCompany(companyId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE company_id = ${companyId} ORDER BY created_at DESC` as RawDelivery[];
    return rows.map(hydrate);
  },

  async findMostRecentActiveDeliveryByContact(phone) {
    await ensureSchema();
    const sql = getSql();
    // Either party texting in gets matched -- the sender tracking what they
    // shipped and the recipient tracking what's coming to them are both
    // legitimate, per the user's explicit call.
    const rows = await sql`SELECT * FROM deliveries WHERE (contact = ${phone} OR recipient_contact = ${phone}) AND status != 'Delivered' ORDER BY created_at DESC LIMIT 1` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async listActiveDeliveriesByContact(phone) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE (contact = ${phone} OR recipient_contact = ${phone}) AND status != 'Delivered'` as RawDelivery[];
    return rows.map(hydrate);
  },

  async findMostRecentActiveDeliveryByCustomerNameQuery(query) {
    await ensureSchema();
    const sql = getSql();
    const trimmed = query.trim();
    if (!trimmed) return null;
    // Exact (case-insensitive) match only -- this runs across EVERY company
    // sharing the WhatsApp Business number, with no phone verification at
    // all (see the webhook route's own comment for why: an inbound text has
    // no company identity attached). A substring match here let a stranger
    // pull another company's private delivery details (destination, weight,
    // price, ETA) just by texting a name that happened to appear anywhere
    // inside someone else's customer field. An exact match still lets a
    // legitimate customer texting in their own real name find their own
    // delivery, without turning "Ahmed" into a skeleton key.
    const rows = await sql`SELECT * FROM deliveries WHERE status != 'Delivered' AND lower(customer) = lower(${trimmed}) ORDER BY created_at DESC LIMIT 1` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE company_id = ${companyId} AND status <> 'Delivered'` as RawDelivery[];

    // Every non-Delivered delivery gets its GPS_BASELINE progress looked up
    // here, one query per delivery, on every single tick -- a major
    // contributor to a production incident where the automation tick
    // reliably exceeded Cloudflare's per-invocation subrequest limit (see
    // fleet-business-tick.ts for the related fixes). Fetching all of them in
    // one batched query up front and looking up from a Map inside the loop
    // is safe: for a delivery that's already linked (the common case), this
    // is exactly the same row the per-delivery query would have returned,
    // since nothing in this function writes GPS_BASELINE for it. For a
    // delivery linking for the first time this tick (firstLink below), the
    // batch was fetched *before* this tick's insert, so a missing map entry
    // there means the insert below is genuinely new -- in which case the
    // baseline is exactly the value being inserted, avoiding the read
    // entirely. The one case that needs care: a delivery that already had a
    // GPS_BASELINE row from some earlier link (e.g. via linkVehicle) losing
    // and regaining sendatrack tracking looks like firstLink again, but its
    // insert below is a no-op (ON CONFLICT DO NOTHING) -- the batch map
    // already holds that pre-existing row, so it's used instead of the
    // fresh (and in that case wrong) computed value.
    const deliveryIds = rows.map((row) => row.id);
    // Batched with the baseline lookup for the same subrequest-budget reason
    // documented above -- one query per tick, not one per delivery.
    const trackingEventRows = deliveryIds.length
      ? await sql`SELECT delivery_id, type, progress FROM delivery_events WHERE delivery_id = ANY(${deliveryIds}::text[]) AND type IN ('GPS_BASELINE', 'SCAN_LOADED')` as Array<{ delivery_id: string; type: string; progress: number }>
      : [];
    const baselineProgressById = new Map(trackingEventRows.filter((row) => row.type === "GPS_BASELINE").map((row) => [row.delivery_id, Number(row.progress)]));
    const scanLoadedIds = new Set(trackingEventRows.filter((row) => row.type === "SCAN_LOADED").map((row) => row.delivery_id));

    for (const raw of rows) {
      const delivery = hydrate(raw);
      const match = matchDeliveryVehicle(delivery, snapshot.vehicles);
      const vehicle = match.vehicle;
      if (!vehicle) continue;

      const firstLink = delivery.gpsSource !== "sendatrack";
      // No mid-route pickups in this business -- a delivery only starts
      // being tracked on its assigned truck once the parcel has actually
      // been scanned "chargé" onto it. Without this, a truck already en
      // route (or one that departs before the delivery is truly loaded)
      // would silently start counting progress the moment automation
      // linked it, with no confirmation the parcel is physically aboard.
      // Only gates the very first link -- a delivery already tracking
      // (gpsSource === "sendatrack") is never retroactively frozen.
      if (firstLink && !scanLoadedIds.has(delivery.id)) continue;
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const origin = explicitOrigin(delivery);
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, origin);
      if (firstLink) {
        await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at) VALUES (${delivery.id}, 'GPS_BASELINE', ${absoluteMetrics.progress}, ${new Date().toISOString()}) ON CONFLICT (delivery_id, type) DO NOTHING`;
      }
      const baseline = resolveGpsBaselineProgress({
        existingBaselineProgress: baselineProgressById.get(delivery.id),
        firstLink,
        freshlyComputedProgress: absoluteMetrics.progress,
      });
      const metrics = rebaseRouteMetrics(absoluteMetrics, origin ? 0 : baseline);
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
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered' LIMIT 1` as RawDelivery[];
    const delivery = rows[0] ? hydrate(rows[0]) : null;
    if (!delivery) return null;
    // Same "no mid-route pickups" rule as applySendatrackSnapshot: manually
    // linking a truck from the table assigns it, but doesn't start counting
    // GPS progress until the parcel has actually been scanned "chargé" onto
    // it. A delivery already tracking (gpsSource === "sendatrack") is never
    // retroactively frozen by this.
    const alreadyTracking = delivery.gpsSource === "sendatrack";
    const scanned = alreadyTracking || Boolean((await sql`SELECT 1 FROM delivery_events WHERE delivery_id = ${delivery.id} AND type = 'SCAN_LOADED' LIMIT 1` as unknown as unknown[])[0]);
    if (scanned) {
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
      await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at) VALUES (${delivery.id}, 'GPS_BASELINE', ${metrics.progress}, ${new Date().toISOString()}) ON CONFLICT (delivery_id, type) DO NOTHING`;
    }
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to run unconditionally here). One truck legitimately
    // carrying several parcels at once is the group feature's whole premise --
    // this single-delivery path is now just linkVehicleToGroup with one member,
    // so it must not evict the truck's existing group the way it used to.
    // Reported live: adding one more unassigned parcel to an already-multi-parcel
    // truck via this per-row action silently kicked its existing members back to
    // unassigned (stale GPS position/status still attached -- a ghost truck on
    // the map) every time. vehicleAssignmentConflict in page.tsx still warns the
    // dispatcher the truck is in use; trusting that warning (not blocking) was
    // already the design, this just stopped corrupting data when they proceed.
    if (scanned) {
      await sql`UPDATE deliveries SET
        sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, latitude = ${vehicle.latitude}, longitude = ${vehicle.longitude},
        speed = ${vehicle.speed}, last_position_at = ${new Date(vehicle.updatedAt).toISOString()}, gps_source = 'sendatrack', status = 'Loading'
        WHERE id = ${delivery.id} AND company_id = ${companyId}`;
    } else {
      await sql`UPDATE deliveries SET sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, status = 'Loading'
        WHERE id = ${delivery.id} AND company_id = ${companyId}`;
    }
    // A trip groups deliveries that share one truck's route (see
    // buildTruckStopPlans in truck-stop-plan.ts, keyed by trip_id when
    // present). Moving this delivery onto a genuinely different truck means
    // it's no longer on that route, so it must leave the trip -- otherwise
    // the trip's own truck/vehicleKey record can end up describing a truck
    // that isn't actually what this delivery is on. Re-linking the same
    // vehicle it already has (a no-op reassignment) leaves the trip intact.
    if (delivery.sendatrackVehicleId !== vehicle.id) {
      await sql`UPDATE deliveries SET trip_id = NULL WHERE id = ${delivery.id} AND company_id = ${companyId}`;
    }
    const updated = await sql`SELECT * FROM deliveries WHERE id = ${delivery.id} AND company_id = ${companyId} LIMIT 1` as RawDelivery[];
    return updated[0] ? hydrate(updated[0]) : null;
  },

  async linkVehicleToGroup(deliveryIds, companyId, vehicle) {
    await ensureSchema();
    const sql = getSql();
    if (!deliveryIds.length) return [];
    const rows = await sql`SELECT * FROM deliveries WHERE id = ANY(${deliveryIds}::text[]) AND company_id = ${companyId} AND status <> 'Delivered'` as RawDelivery[];
    if (!rows.length) return [];
    const deliveries = rows.map(hydrate);
    const matchedIds = deliveries.map((delivery) => delivery.id);
    // Same "no mid-route pickups" rule as linkVehicle/applySendatrackSnapshot
    // -- see linkVehicle for the full rationale. Batched (one query for the
    // whole group) rather than per-delivery.
    const unscannedIds = new Set(deliveries.filter((delivery) => delivery.gpsSource !== "sendatrack").map((delivery) => delivery.id));
    const scannedRows = unscannedIds.size
      ? await sql`SELECT DISTINCT delivery_id FROM delivery_events WHERE delivery_id = ANY(${[...unscannedIds]}::text[]) AND type = 'SCAN_LOADED'` as Array<{ delivery_id: string }>
      : [];
    for (const row of scannedRows) unscannedIds.delete(row.delivery_id);
    const scannedIds = matchedIds.filter((id) => !unscannedIds.has(id));
    for (const delivery of deliveries) {
      if (!scannedIds.includes(delivery.id)) continue;
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
      await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at) VALUES (${delivery.id}, 'GPS_BASELINE', ${metrics.progress}, ${new Date().toISOString()}) ON CONFLICT (delivery_id, type) DO NOTHING`;
    }
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to run unconditionally here). One truck legitimately
    // carrying several parcels at once is the group feature's whole premise --
    // this must not evict the target truck's existing group the same way
    // linkVehicle used to (see that fix). Reassigning group A onto a truck
    // that already carries group B would otherwise silently kick B back to
    // unassigned, with its last GPS position/status still attached.
    if (scannedIds.length) {
      await sql`UPDATE deliveries SET
        sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, latitude = ${vehicle.latitude}, longitude = ${vehicle.longitude},
        speed = ${vehicle.speed}, last_position_at = ${new Date(vehicle.updatedAt).toISOString()}, gps_source = 'sendatrack', status = 'Loading'
        WHERE id = ANY(${scannedIds}::text[]) AND company_id = ${companyId}`;
    }
    if (unscannedIds.size) {
      await sql`UPDATE deliveries SET sendatrack_vehicle_id = ${vehicle.id}, truck = ${vehicle.name}, status = 'Loading'
        WHERE id = ANY(${[...unscannedIds]}::text[]) AND company_id = ${companyId}`;
    }
    const changingVehicleIds = deliveries.filter((delivery) => delivery.sendatrackVehicleId !== vehicle.id).map((delivery) => delivery.id);
    if (changingVehicleIds.length) {
      await sql`UPDATE deliveries SET trip_id = NULL WHERE id = ANY(${changingVehicleIds}::text[]) AND company_id = ${companyId}`;
    }
    const updated = await sql`SELECT * FROM deliveries WHERE id = ANY(${matchedIds}::text[]) AND company_id = ${companyId}` as RawDelivery[];
    return updated.map(hydrate);
  },

  async updateSchedule(deliveryId, companyId, input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered' LIMIT 1` as RawDelivery[];
    if (!rows[0]) return null;
    await sql`UPDATE deliveries SET
      planned_arrival_at = ${input.plannedArrivalAt?.toISOString() ?? null}, next_truck_departure_at = ${input.nextTruckDepartureAt?.toISOString() ?? null}
      WHERE id = ${deliveryId} AND company_id = ${companyId}`;
    const updated = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} LIMIT 1` as RawDelivery[];
    return updated[0] ? hydrate(updated[0]) : null;
  },
  async updateDetails(deliveryId, companyId, input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered' LIMIT 1` as RawDelivery[];
    if (!rows[0]) return null;
    await sql`UPDATE deliveries SET
      customer = ${input.customer}, contact = ${input.contact}, customer_email = ${input.customerEmail},
      recipient_name = ${input.recipientName}, recipient_contact = ${input.recipientContact},
      weight_kg = ${input.weightKg}, price_amount = ${input.priceAmount}, price_currency = ${input.priceCurrency},
      payment_status = ${input.paymentStatus}, amount_paid = ${input.amountPaid},
      item_description = ${input.itemDescription}, destination_site_id = ${input.destinationSiteId}, destination = ${input.destination},
      destination_latitude = ${input.destinationLatitude}, destination_longitude = ${input.destinationLongitude},
      arrival_radius_km = ${input.arrivalRadiusKm}, planned_arrival_at = ${input.plannedArrivalAt?.toISOString() ?? null}
      WHERE id = ${deliveryId} AND company_id = ${companyId}`;
    const updated = await sql`SELECT * FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} LIMIT 1` as RawDelivery[];
    return updated[0] ? hydrate(updated[0]) : null;
  },
  async recordEvent(deliveryId, type, progress) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      VALUES (${deliveryId}, ${type}, ${progress}, ${new Date().toISOString()})
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id` as Array<{ delivery_id: string }>;
    return rows.length > 0;
  },

  async listEvents(deliveryId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT delivery_id, type, progress, created_at FROM delivery_events WHERE delivery_id = ${deliveryId} ORDER BY created_at ASC` as RawEvent[];
    return rows.map(hydrateEvent);
  },

  async listEventsForDeliveries(companyId, deliveryIds) {
    const byDeliveryId = new Map<string, DeliveryEventRow[]>();
    if (!deliveryIds.length) return byDeliveryId;
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT delivery_id, type, progress, created_at FROM delivery_events
      WHERE delivery_id = ANY(${deliveryIds}::text[]) ORDER BY delivery_id ASC, created_at ASC` as RawEvent[];
    for (const row of rows) {
      const event = hydrateEvent(row);
      const existing = byDeliveryId.get(event.deliveryId);
      if (existing) existing.push(event); else byDeliveryId.set(event.deliveryId, [event]);
    }
    return byDeliveryId;
  },

  async recordEtaObservation(input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`INSERT INTO delivery_eta_observations (
      delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
    ) VALUES (
      ${input.deliveryId}, ${input.companyId}, ${input.routeTemplateId}, ${input.tripInstanceId}, ${input.destinationSiteId}, ${input.positionAt.toISOString()}, ${input.estimatedArrivalAt.toISOString()}, ${input.plannedArrivalAt?.toISOString() ?? null}, ${input.delayMinutes}, ${input.effectiveSpeedKmh}, ${input.remainingDistanceKm}, ${input.progress}, ${input.confidence}, ${input.source}, ${new Date().toISOString()}
    ) ON CONFLICT (delivery_id, position_at) DO NOTHING RETURNING delivery_id` as Array<{ delivery_id: string }>;
    return rows.length > 0;
  },

  async listEtaObservations(deliveryId, limit = 200) {
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(2000, Math.round(limit)));
    const rows = await sql`SELECT delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
      FROM delivery_eta_observations WHERE delivery_id = ${deliveryId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      deliveryId: String(row.delivery_id), companyId: String(row.company_id ?? ""), routeTemplateId: row.route_template_id ? String(row.route_template_id) : null, tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null, destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
      positionAt: new Date(String(row.position_at)), estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
      plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null, delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
      effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh), remainingDistanceKm: Number(row.remaining_distance_km), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(String(row.created_at)),
    }));
  },
  async listEtaObservationsForDeliveries(companyId, deliveryIds, limitPerDelivery = 2000) {
    const byDeliveryId = new Map<string, EtaObservationRow[]>();
    if (!deliveryIds.length) return byDeliveryId;
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(2000, Math.round(limitPerDelivery)));
    // DISTINCT ON + ORDER BY position_at DESC caps each delivery to its own
    // most-recent `capped` observations in one query, instead of one query
    // per delivery -- same shape as the per-delivery listEtaObservations
    // above, just for every delivery id at once.
    const rows = await sql`SELECT delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
      FROM (
        SELECT *, row_number() OVER (PARTITION BY delivery_id ORDER BY position_at DESC) AS rn
        FROM delivery_eta_observations
        WHERE company_id = ${companyId} AND delivery_id = ANY(${deliveryIds}::text[])
      ) ranked WHERE rn <= ${capped}
      ORDER BY delivery_id ASC, position_at DESC` as Array<Record<string, unknown>>;
    for (const row of rows) {
      const observation: EtaObservationRow = {
        deliveryId: String(row.delivery_id), companyId: String(row.company_id ?? ""), routeTemplateId: row.route_template_id ? String(row.route_template_id) : null, tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null, destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
        positionAt: new Date(String(row.position_at)), estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
        plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null, delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
        effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh), remainingDistanceKm: Number(row.remaining_distance_km), progress: Number(row.progress),
        confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(String(row.created_at)),
      };
      const existing = byDeliveryId.get(observation.deliveryId);
      if (existing) existing.push(observation); else byDeliveryId.set(observation.deliveryId, [observation]);
    }
    return byDeliveryId;
  },
  async listEtaObservationsForRoute(companyId, routeTemplateId, destinationSiteId, limit = 5000) {
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(10000, Math.round(limit)));
    const rows = await sql`SELECT delivery_id, company_id, route_template_id, trip_instance_id, destination_site_id, position_at, estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
      FROM delivery_eta_observations WHERE company_id = ${companyId} AND route_template_id = ${routeTemplateId} AND destination_site_id = ${destinationSiteId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      deliveryId: String(row.delivery_id), companyId: String(row.company_id ?? ""), routeTemplateId: row.route_template_id ? String(row.route_template_id) : null, tripInstanceId: row.trip_instance_id ? String(row.trip_instance_id) : null, destinationSiteId: row.destination_site_id ? String(row.destination_site_id) : null,
      positionAt: new Date(String(row.position_at)), estimatedArrivalAt: new Date(String(row.estimated_arrival_at)),
      plannedArrivalAt: row.planned_arrival_at ? new Date(String(row.planned_arrival_at)) : null, delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
      effectiveSpeedKmh: row.effective_speed_kmh === null ? null : Number(row.effective_speed_kmh), remainingDistanceKm: Number(row.remaining_distance_km), progress: Number(row.progress),
      confidence: String(row.confidence) as EtaObservationRow["confidence"], source: String(row.source) as EtaObservationRow["source"], createdAt: new Date(String(row.created_at)),
    }));
  },

  async recordTripPosition(input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`INSERT INTO trip_position_observations (company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at)
      VALUES (${input.companyId}, ${input.routeTemplateId}, ${input.tripInstanceId}, ${input.vehicleId}, ${input.positionAt.toISOString()}, ${input.latitude}, ${input.longitude}, ${input.speed}, ${new Date().toISOString()})
      ON CONFLICT (company_id, trip_instance_id, position_at) DO NOTHING RETURNING trip_instance_id` as Array<{ trip_instance_id: string }>;
    return rows.length > 0;
  },
  async listTripPositionsForRoute(companyId, routeTemplateId, limit = 10000) {
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(20000, Math.round(limit)));
    const rows = await sql`SELECT company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
      FROM trip_position_observations WHERE company_id = ${companyId} AND route_template_id = ${routeTemplateId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      companyId: String(row.company_id), routeTemplateId: String(row.route_template_id), tripInstanceId: String(row.trip_instance_id), vehicleId: String(row.vehicle_id),
      positionAt: new Date(String(row.position_at)), latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), createdAt: new Date(String(row.created_at)),
    }));
  },

  async recordFleetPosition(input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`INSERT INTO fleet_position_observations (company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at)
      VALUES (${input.companyId}, ${input.vehicleId}, ${input.vehicleName}, ${input.positionAt.toISOString()}, ${input.latitude}, ${input.longitude}, ${input.speed}, ${input.heading}, ${input.address}, ${new Date().toISOString()})
      ON CONFLICT (company_id, vehicle_id, position_at) DO NOTHING RETURNING vehicle_id` as Array<{ vehicle_id: string }>;
    return rows.length > 0;
  },
  async listFleetPositions(companyId, vehicleId, limit = 20000) {
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(50000, Math.round(limit)));
    const rows = await sql`SELECT company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at
      FROM fleet_position_observations WHERE company_id = ${companyId} AND vehicle_id = ${vehicleId} ORDER BY position_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      companyId: String(row.company_id), vehicleId: String(row.vehicle_id), vehicleName: String(row.vehicle_name), positionAt: new Date(String(row.position_at)),
      latitude: Number(row.latitude), longitude: Number(row.longitude), speed: Number(row.speed), heading: row.heading == null ? null : Number(row.heading), address: String(row.address ?? ''), createdAt: new Date(String(row.created_at)),
    }));
  },

  async upsertTrip(input) {
    await ensureSchema();
    const sql = getSql();
    const now = new Date().toISOString();
    const stopsJson = JSON.stringify(input.stops.map((stop) => ({ ...stop, plannedArrivalAt: stop.plannedArrivalAt?.toISOString() ?? null })));
    const rows = await sql`INSERT INTO trips (id, company_id, route_template_id, vehicle_key, truck, sendatrack_vehicle_id, origin_site_id, stops_json, status, created_at, updated_at)
      VALUES (${input.id}, ${input.companyId}, ${input.routeTemplateId}, ${input.vehicleKey}, ${input.truck}, ${input.sendatrackVehicleId}, ${input.originSiteId}, ${stopsJson}, ${input.status}, ${now}, ${now})
      ON CONFLICT (company_id, id) DO UPDATE SET
        route_template_id = EXCLUDED.route_template_id,
        vehicle_key = EXCLUDED.vehicle_key,
        truck = EXCLUDED.truck,
        sendatrack_vehicle_id = EXCLUDED.sendatrack_vehicle_id,
        origin_site_id = EXCLUDED.origin_site_id,
        stops_json = EXCLUDED.stops_json,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
      RETURNING *` as Array<Record<string, unknown>>;
    return hydrateTrip(rows[0]);
  },
  async getTrip(companyId, tripId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM trips WHERE company_id = ${companyId} AND id = ${tripId} LIMIT 1` as Array<Record<string, unknown>>;
    return rows[0] ? hydrateTrip(rows[0]) : null;
  },
  async listTrips(companyId, limit = 100) {
    await ensureSchema();
    const sql = getSql();
    const capped = Math.max(1, Math.min(1000, Math.round(limit)));
    const rows = await sql`SELECT * FROM trips WHERE company_id = ${companyId} ORDER BY updated_at DESC LIMIT ${capped}` as Array<Record<string, unknown>>;
    return rows.map(hydrateTrip);
  },

  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`UPDATE deliveries SET trip_id = ${tripId}
      WHERE id = ${deliveryId} AND company_id = ${companyId} AND (trip_id IS NULL OR trip_id = ${tripId})
      RETURNING id` as Array<{ id: string }>;
    return rows.length > 0;
  },
  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`UPDATE deliveries SET trip_id = ${tripId}, truck = ${truck}, sendatrack_vehicle_id = ${sendatrackVehicleId}
      WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered' AND trip_id IS NULL
        AND truck = ${UNASSIGNED_TRUCK} AND (sendatrack_vehicle_id IS NULL OR sendatrack_vehicle_id = '')
      RETURNING *` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },
  async listDeliveryIdsForTrip(companyId, tripId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT id FROM deliveries WHERE company_id = ${companyId} AND trip_id = ${tripId} ORDER BY created_at ASC` as Array<{ id: string }>;
    return rows.map((row) => row.id);
  },

  async listPendingNotifications(companyId) {
    await ensureSchema();
    const sql = getSql();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const rows = await sql`SELECT d.*,
        e.delivery_id AS event_delivery_id,
        e.type AS event_type,
        e.progress AS event_progress,
        e.created_at AS event_created_at
      FROM delivery_events e
      JOIN deliveries d ON d.id = e.delivery_id
      LEFT JOIN delivery_notifications n ON n.delivery_id = e.delivery_id AND n.event_type = e.type AND n.channel = 'whatsapp'
      WHERE d.company_id = ${companyId}
        AND n.sent_at IS NULL
        AND (n.attempted_at IS NULL OR n.attempted_at < ${staleBefore})
      ORDER BY e.created_at ASC` as RawPendingNotification[];
    return rows.flatMap((row) => {
      const event = hydrateEvent({
        delivery_id: row.event_delivery_id,
        type: row.event_type,
        progress: row.event_progress,
        created_at: row.event_created_at,
      });
      if (!customerFacingEvent(event.type)) return [];
      return [{ delivery: hydrate(row), event }];
    });
  },

  async claimNotification(deliveryId, type) {
    await ensureSchema();
    const sql = getSql();
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
    const sql = getSql();
    await sql`UPDATE delivery_notifications SET sent_at = ${new Date().toISOString()}
      WHERE delivery_id = ${deliveryId} AND event_type = ${type} AND channel = 'whatsapp'`;
  },

  // Deliberately a no-op: deleting the row here would let a permanently
  // failing send (e.g. an expired provider token) be reclaimed on literally
  // the next call instead of after the stale window above, since
  // claimNotification's own "attempted_at < staleBefore" check would have
  // nothing left to compare against once the row is gone.
  async releaseNotification(_deliveryId, _type) {},

  // Client asked for a short, human-friendly parcel identifier for the
  // printed label (e.g. "CAS 00", "CAS 01"), separate from and additional
  // to the internal TF-xxxx id -- never resets, one lifetime sequence per
  // (company, prefix). The upsert+RETURNING is a single atomic round trip:
  // concurrent dispatchers creating deliveries to the same city at once
  // can never be handed the same number.
  async assignShortCode(companyId, prefix) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`
      INSERT INTO delivery_code_counters (company_id, prefix, next_number)
      VALUES (${companyId}, ${prefix}, 0)
      ON CONFLICT (company_id, prefix) DO UPDATE SET next_number = delivery_code_counters.next_number + 1
      RETURNING next_number
    ` as Array<{ next_number: number }>;
    return `${prefix} ${String(rows[0].next_number).padStart(2, "0")}`;
  },

  async create(input: CreateDeliveryInput) {
    await ensureSchema();
    const sql = getSql();
    const delivery: DeliveryRow = {
      ...input,
      whatsappOptIn: input.whatsappOptIn === true,
      whatsappOptInAt: input.whatsappOptIn === true ? (input.whatsappOptInAt ?? new Date()) : null,
      recipientWhatsappOptIn: input.recipientWhatsappOptIn === true,
      recipientWhatsappOptInAt: input.recipientWhatsappOptIn === true ? (input.recipientWhatsappOptInAt ?? new Date()) : null,
      paymentStatus: input.paymentStatus ?? "unpaid",
      id: createDeliveryId(),
      createdAt: new Date(),
    };
    await sql`INSERT INTO deliveries (
      id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination, destination_latitude, destination_longitude, arrival_radius_km,
      truck, driver, status, eta, planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, customer_email, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at, sendatrack_vehicle_id,
      latitude, longitude, speed, last_position_at, gps_source, company_id, tracking_token, shipment_id, created_at, parcel_code, short_code, payment_status, amount_paid
    ) VALUES (
      ${delivery.id}, ${delivery.customer}, ${delivery.originSiteId}, ${delivery.originLatitude}, ${delivery.originLongitude}, ${delivery.destinationSiteId}, ${delivery.destination}, ${delivery.destinationLatitude}, ${delivery.destinationLongitude}, ${delivery.arrivalRadiusKm},
      ${delivery.truck}, ${delivery.driver}, ${delivery.status}, ${delivery.eta}, ${delivery.plannedArrivalAt?.toISOString() ?? null}, ${delivery.nextTruckDepartureAt?.toISOString() ?? null}, ${delivery.progress}, ${delivery.color}, ${delivery.contact}, ${delivery.recipientName ?? ""}, ${delivery.recipientContact ?? ""}, ${delivery.weightKg ?? null}, ${delivery.priceAmount ?? null}, ${delivery.priceCurrency ?? null}, ${delivery.itemDescription ?? null}, ${delivery.customerEmail ?? null}, ${delivery.whatsappOptIn === true}, ${delivery.whatsappOptInAt?.toISOString() ?? null}, ${delivery.recipientWhatsappOptIn === true}, ${delivery.recipientWhatsappOptInAt?.toISOString() ?? null}, ${delivery.sendatrackVehicleId},
      ${delivery.latitude}, ${delivery.longitude}, ${delivery.speed}, ${delivery.lastPositionAt?.toISOString() ?? null}, ${delivery.gpsSource}, ${delivery.companyId}, ${delivery.trackingToken}, ${delivery.shipmentId ?? null}, ${delivery.createdAt.toISOString()}, ${delivery.parcelCode ?? null}, ${delivery.shortCode ?? null}, ${delivery.paymentStatus ?? null}, ${delivery.amountPaid ?? null}
    )`;
    return delivery;
  },

  async findByParcelCode(companyId, parcelCode) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM deliveries WHERE company_id = ${companyId} AND parcel_code = ${parcelCode} LIMIT 1` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async recordScan(input) {
    await ensureSchema();
    const sql = getSql();
    const scan: DeliveryScanRow = { ...input, id: createDeliveryId(), scannedAt: new Date() };
    await sql`INSERT INTO delivery_scans (id, company_id, delivery_id, checkpoint, scanned_by, truck, location_label, scanned_at)
      VALUES (${scan.id}, ${scan.companyId}, ${scan.deliveryId}, ${scan.checkpoint}, ${scan.scannedBy}, ${scan.truck}, ${scan.locationLabel}, ${scan.scannedAt.toISOString()})`;
    return scan;
  },

  async listScansForDelivery(deliveryId, limit = 50) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT id, company_id, delivery_id, checkpoint, scanned_by, truck, location_label, scanned_at FROM delivery_scans
      WHERE delivery_id = ${deliveryId} ORDER BY scanned_at DESC LIMIT ${Math.max(1, Math.min(500, limit))}` as Array<{
        id: string; company_id: string; delivery_id: string; checkpoint: DeliveryScanCheckpoint;
        scanned_by: string; truck: string | null; location_label: string | null; scanned_at: string | Date;
      }>;
    return rows.map((row) => ({
      id: row.id, companyId: row.company_id, deliveryId: row.delivery_id, checkpoint: row.checkpoint,
      scannedBy: row.scanned_by, truck: row.truck, locationLabel: row.location_label, scannedAt: new Date(row.scanned_at),
    }));
  },

  async listScanSummaries(companyId, deliveryIds) {
    if (!deliveryIds.length) return [];
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT delivery_id, checkpoint, truck, location_label, scanned_at FROM delivery_scans
      WHERE company_id = ${companyId} AND delivery_id = ANY(${deliveryIds}::text[])
        AND checkpoint IN ('loaded', 'arrived')
      ORDER BY delivery_id ASC, scanned_at DESC` as Array<{
        delivery_id: string; checkpoint: DeliveryScanCheckpoint; truck: string | null;
        location_label: string | null; scanned_at: string | Date;
      }>;
    const summaries = new Map<string, DeliveryScanSummary>();
    for (const row of rows) {
      const summary = summaries.get(row.delivery_id) ?? {
        deliveryId: row.delivery_id, loadedAt: null, loadedTruck: null, loadedLabel: null, hubArrivedAt: null, hubLabel: null,
      };
      if (row.checkpoint === "loaded" && !summary.loadedAt) {
        summary.loadedAt = new Date(row.scanned_at);
        summary.loadedTruck = row.truck;
        summary.loadedLabel = row.location_label;
      }
      if (row.checkpoint === "arrived" && !summary.hubArrivedAt) {
        summary.hubArrivedAt = new Date(row.scanned_at);
        summary.hubLabel = row.location_label;
      }
      summaries.set(row.delivery_id, summary);
    }
    return [...summaries.values()];
  },

  async deleteDemoDeliveries(companyId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT id FROM deliveries WHERE company_id = ${companyId} AND customer LIKE ${`${DEMO_DELIVERY_CUSTOMER_PREFIX}%`}` as Array<{ id: string }>;
    const ids = rows.map((row) => row.id);
    if (!ids.length) return 0;
    await sql`DELETE FROM delivery_events WHERE delivery_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM delivery_notifications WHERE delivery_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM delivery_eta_observations WHERE delivery_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM delivery_scans WHERE delivery_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM deliveries WHERE id = ANY(${ids}::text[])`;
    return ids.length;
  },

  async deleteDelivery(deliveryId, companyId) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT id FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId} LIMIT 1` as Array<{ id: string }>;
    if (!rows.length) return false;
    await sql`DELETE FROM delivery_events WHERE delivery_id = ${deliveryId}`;
    await sql`DELETE FROM delivery_notifications WHERE delivery_id = ${deliveryId}`;
    await sql`DELETE FROM delivery_eta_observations WHERE delivery_id = ${deliveryId}`;
    await sql`DELETE FROM delivery_scans WHERE delivery_id = ${deliveryId}`;
    await sql`DELETE FROM deliveries WHERE id = ${deliveryId}`;
    return true;
  },
  async advanceDemoDelivery(deliveryId, companyId, input) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`UPDATE deliveries SET
      status = ${input.status}, progress = ${input.progress}, latitude = ${input.latitude}, longitude = ${input.longitude},
      speed = ${input.speed}, last_position_at = ${new Date().toISOString()}, gps_source = 'simulation'
      WHERE id = ${deliveryId} AND company_id = ${companyId} AND customer LIKE ${`${DEMO_DELIVERY_CUSTOMER_PREFIX}%`}
      RETURNING *` as RawDelivery[];
    return rows[0] ? hydrate(rows[0]) : null;
  },
};
