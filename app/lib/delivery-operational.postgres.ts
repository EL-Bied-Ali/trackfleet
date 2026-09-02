import "./postgres-runtime-bootstrap";
import { neon } from "@neondatabase/serverless";
import type { DeliveryRow, DeliveryStatus } from "./delivery-store.types";

export const OPERATIONAL_RECENT_DAYS = 7;
export const OPERATIONAL_RECENT_COMPLETED_LIMIT = 200;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for operational Postgres delivery reads");
const sql = neon(databaseUrl);

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
  };
}

export async function loadOperationalDeliveries(companyId: string): Promise<DeliveryRow[]> {
  const recentDays = OPERATIONAL_RECENT_DAYS;
  const recentCompletedLimit = OPERATIONAL_RECENT_COMPLETED_LIMIT;
  const rows = await sql`
    WITH active AS (
      SELECT delivery.*
      FROM deliveries delivery
      WHERE delivery.company_id = ${companyId}
        AND delivery.status <> 'Delivered'
    ), recent_completed AS (
      SELECT delivery.*
      FROM deliveries delivery
      WHERE delivery.company_id = ${companyId}
        AND delivery.status = 'Delivered'
        AND (
          delivery.created_at >= NOW() - (${recentDays} * INTERVAL '1 day')
          OR EXISTS (
            SELECT 1
            FROM delivery_events event
            WHERE event.delivery_id = delivery.id
              AND event.created_at >= NOW() - (${recentDays} * INTERVAL '1 day')
          )
        )
      ORDER BY delivery.created_at DESC
      LIMIT ${recentCompletedLimit}
    )
    SELECT * FROM active
    UNION ALL
    SELECT * FROM recent_completed
    ORDER BY created_at DESC
  ` as RawDelivery[];
  return rows.map(hydrate);
}
