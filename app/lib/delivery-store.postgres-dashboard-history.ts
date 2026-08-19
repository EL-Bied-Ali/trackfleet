import "./postgres-runtime-bootstrap";
import { neon } from "@neondatabase/serverless";
import type { DashboardHistoryBundle, DeliveryEventRow } from "./delivery-store.types";
import type { DeliveryEventType } from "./delivery-events";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for batched dashboard history");
const sql = neon(databaseUrl);

type RawDashboardHistoryRow = {
  kind: "event" | "context";
  delivery_id: string;
  type: string | null;
  progress: number | string | null;
  created_at: string | Date | null;
  route_template_id: string | null;
  trip_instance_id: string | null;
  destination_site_id: string | null;
};

function emptyBundle(): DashboardHistoryBundle {
  return { eventsByDelivery: {}, stableEtaContextsByDelivery: {} };
}

export async function loadPostgresDashboardHistory(deliveryIds: string[]): Promise<DashboardHistoryBundle> {
  const ids = [...new Set(deliveryIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return emptyBundle();

  const rows = await sql`
    WITH frozen_context AS (
      SELECT DISTINCT ON (observation.delivery_id)
        observation.delivery_id,
        observation.route_template_id,
        observation.trip_instance_id,
        observation.destination_site_id
      FROM delivery_eta_observations observation
      JOIN delivery_events departed
        ON departed.delivery_id = observation.delivery_id
       AND departed.type = 'DEPARTED'
      WHERE observation.delivery_id = ANY(${ids}::text[])
        AND observation.position_at >= departed.created_at
        AND observation.route_template_id IS NOT NULL
        AND observation.trip_instance_id IS NOT NULL
        AND observation.destination_site_id IS NOT NULL
      ORDER BY observation.delivery_id, observation.position_at ASC
    )
    SELECT
      'event'::text AS kind,
      event.delivery_id,
      event.type,
      event.progress,
      event.created_at,
      NULL::text AS route_template_id,
      NULL::text AS trip_instance_id,
      NULL::text AS destination_site_id
    FROM delivery_events event
    WHERE event.delivery_id = ANY(${ids}::text[])

    UNION ALL

    SELECT
      'context'::text AS kind,
      context.delivery_id,
      NULL::text AS type,
      NULL::integer AS progress,
      NULL::timestamptz AS created_at,
      context.route_template_id,
      context.trip_instance_id,
      context.destination_site_id
    FROM frozen_context context

    ORDER BY delivery_id, kind, created_at NULLS LAST
  ` as RawDashboardHistoryRow[];

  const result = emptyBundle();
  for (const row of rows) {
    if (row.kind === "context") {
      if (row.route_template_id && row.trip_instance_id && row.destination_site_id) {
        result.stableEtaContextsByDelivery[row.delivery_id] = {
          routeTemplateId: row.route_template_id,
          tripInstanceId: row.trip_instance_id,
          destinationSiteId: row.destination_site_id,
        };
      }
      continue;
    }

    if (!row.type || row.progress === null || row.created_at === null) continue;
    const event: DeliveryEventRow = {
      deliveryId: row.delivery_id,
      type: row.type as DeliveryEventType,
      progress: Number(row.progress),
      createdAt: new Date(row.created_at),
    };
    (result.eventsByDelivery[row.delivery_id] ??= []).push(event);
  }

  return result;
}
