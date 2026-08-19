import "./postgres-runtime-bootstrap";
import { neon } from "@neondatabase/serverless";
import type { DeliveryEventRow, EtaObservationRow } from "./delivery-store.types";
import type { DeliveryEventType } from "./delivery-events";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for batched Postgres reads");
const sql = neon(databaseUrl);

type RawEvent = {
  delivery_id: string;
  type: string;
  progress: number | string;
  created_at: string | Date;
};

type RawEta = Record<string, unknown> & { delivery_id: string };

function uniqueKeys(keys: string[]) {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

function hydrateEta(row: RawEta): EtaObservationRow {
  return {
    deliveryId: String(row.delivery_id),
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

export async function loadEventBatch(keys: string[]): Promise<Record<string, DeliveryEventRow[]>> {
  const deliveryIds = uniqueKeys(keys);
  if (!deliveryIds.length) return {};
  const rows = await sql`
    SELECT delivery_id, type, progress, created_at
    FROM delivery_events
    WHERE delivery_id = ANY(${deliveryIds}::text[])
    ORDER BY delivery_id, created_at ASC
  ` as RawEvent[];

  const result: Record<string, DeliveryEventRow[]> = {};
  for (const row of rows) {
    (result[row.delivery_id] ??= []).push({
      deliveryId: row.delivery_id,
      type: row.type as DeliveryEventType,
      progress: Number(row.progress),
      createdAt: new Date(row.created_at),
    });
  }
  return result;
}

export async function loadEtaBatch(keys: string[], maxLimit: number): Promise<Record<string, EtaObservationRow[]>> {
  const deliveryIds = uniqueKeys(keys);
  if (!deliveryIds.length) return {};
  const capped = Math.max(1, Math.min(2000, Math.round(maxLimit)));
  const rows = await sql`
    SELECT delivery_id, route_template_id, trip_instance_id, destination_site_id,
      position_at, estimated_arrival_at, planned_arrival_at, delay_minutes,
      effective_speed_kmh, remaining_distance_km, progress, confidence, source, created_at
    FROM (
      SELECT observation.*,
        row_number() OVER (PARTITION BY delivery_id ORDER BY position_at DESC) AS row_number
      FROM delivery_eta_observations observation
      WHERE delivery_id = ANY(${deliveryIds}::text[])
    ) ranked
    WHERE row_number <= ${capped}
    ORDER BY delivery_id, position_at DESC
  ` as RawEta[];

  const result: Record<string, EtaObservationRow[]> = {};
  for (const row of rows) (result[row.delivery_id] ??= []).push(hydrateEta(row));
  return result;
}
