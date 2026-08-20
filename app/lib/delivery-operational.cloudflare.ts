import { runtimeEnv } from "trackfleet-runtime-env";
import type { DeliveryRow, DeliveryStatus } from "./delivery-store.types";

const OPERATIONAL_RECENT_DAYS = 7;
const OPERATIONAL_RECENT_COMPLETED_LIMIT = 200;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
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
  createdAt: number;
};

function db() {
  const binding = (runtimeEnv as unknown as { DB?: D1Binding }).DB;
  if (!binding) throw new Error("D1 database binding is missing");
  return binding;
}

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
    weightKg: row.weightKg ?? null,
    priceAmount: row.priceAmount ?? null,
    priceCurrency: row.priceCurrency === "EUR" || row.priceCurrency === "MAD" ? row.priceCurrency : null,
    recipientName: row.recipientName ?? "",
    recipientContact: row.recipientContact ?? "",
    plannedArrivalAt: row.plannedArrivalAt ? new Date(row.plannedArrivalAt) : null,
    whatsappOptIn: row.whatsappOptIn === 1,
    whatsappOptInAt: row.whatsappOptInAt ? new Date(row.whatsappOptInAt) : null,
    recipientWhatsappOptIn: row.recipientWhatsappOptIn === 1,
    recipientWhatsappOptInAt: row.recipientWhatsappOptInAt ? new Date(row.recipientWhatsappOptInAt) : null,
    lastPositionAt: row.lastPositionAt ? new Date(row.lastPositionAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

const selectColumns = `id, customer, origin_site_id AS originSiteId, origin_latitude AS originLatitude,
  origin_longitude AS originLongitude, destination_site_id AS destinationSiteId, destination,
  destination_latitude AS destinationLatitude, destination_longitude AS destinationLongitude,
  arrival_radius_km AS arrivalRadiusKm, truck, driver, status, eta,
  planned_arrival_at AS plannedArrivalAt, progress, color, contact, recipient_name AS recipientName, recipient_contact AS recipientContact,
  weight_kg AS weightKg, price_amount AS priceAmount, price_currency AS priceCurrency,
  whatsapp_opt_in AS whatsappOptIn, whatsapp_opt_in_at AS whatsappOptInAt,
  recipient_whatsapp_opt_in AS recipientWhatsappOptIn, recipient_whatsapp_opt_in_at AS recipientWhatsappOptInAt,
  sendatrack_vehicle_id AS sendatrackVehicleId, latitude, longitude, speed,
  last_position_at AS lastPositionAt, gps_source AS gpsSource, company_id AS companyId,
  tracking_token AS trackingToken, trip_id AS tripId, created_at AS createdAt`;

export async function loadOperationalDeliveriesFromD1(companyId: string): Promise<DeliveryRow[]> {
  const cutoff = Date.now() - OPERATIONAL_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const result = await db().prepare(`WITH active AS (
      SELECT ${selectColumns}
      FROM deliveries
      WHERE company_id = ? AND status <> 'Delivered'
    ), recent_completed AS (
      SELECT ${selectColumns}
      FROM deliveries delivery
      WHERE company_id = ? AND status = 'Delivered'
        AND (
          created_at >= ?
          OR EXISTS (
            SELECT 1 FROM delivery_events event
            WHERE event.delivery_id = delivery.id AND event.created_at >= ?
          )
        )
      ORDER BY created_at DESC
      LIMIT ${OPERATIONAL_RECENT_COMPLETED_LIMIT}
    )
    SELECT * FROM active
    UNION ALL
    SELECT * FROM recent_completed
    ORDER BY createdAt DESC`)
    .bind(companyId, companyId, cutoff, cutoff)
    .all<RawDelivery>();
  return (result.results ?? []).map(hydrate);
}
