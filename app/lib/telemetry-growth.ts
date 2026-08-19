import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";
import { project30dRows } from "./telemetry-growth-projection";

export type TelemetryGrowthMetric = {
  key: "fleet_positions" | "trip_positions" | "eta_observations" | "delivery_events";
  totalRows: number;
  last24hRows: number;
  last7dRows: number;
  oldestAt: string | null;
  newestAt: string | null;
  projected30dRows: number;
};

export type TelemetryGrowthReport = {
  available: boolean;
  generatedAt: string;
  metrics: TelemetryGrowthMetric[];
};

type RawMetric = {
  key: TelemetryGrowthMetric["key"];
  total_rows: number | string;
  last_24h_rows: number | string;
  last_7d_rows: number | string;
  oldest_at: Date | string | null;
  newest_at: Date | string | null;
};

function iso(value: Date | string | null) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export async function getTelemetryGrowthReport(companyId: string): Promise<TelemetryGrowthReport> {
  const databaseUrl = runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return { available: false, generatedAt: new Date().toISOString(), metrics: [] };

  const sql = neon(databaseUrl);
  const rows = await sql`
    WITH metrics AS (
      SELECT
        'fleet_positions'::text AS key,
        COUNT(*)::bigint AS total_rows,
        COUNT(*) FILTER (WHERE position_at >= NOW() - INTERVAL '24 hours')::bigint AS last_24h_rows,
        COUNT(*) FILTER (WHERE position_at >= NOW() - INTERVAL '7 days')::bigint AS last_7d_rows,
        MIN(position_at) AS oldest_at,
        MAX(position_at) AS newest_at
      FROM fleet_position_observations
      WHERE company_id = ${companyId}

      UNION ALL

      SELECT
        'trip_positions'::text AS key,
        COUNT(*)::bigint,
        COUNT(*) FILTER (WHERE position_at >= NOW() - INTERVAL '24 hours')::bigint,
        COUNT(*) FILTER (WHERE position_at >= NOW() - INTERVAL '7 days')::bigint,
        MIN(position_at),
        MAX(position_at)
      FROM trip_position_observations
      WHERE company_id = ${companyId}

      UNION ALL

      SELECT
        'eta_observations'::text AS key,
        COUNT(observation.*)::bigint,
        COUNT(observation.*) FILTER (WHERE observation.position_at >= NOW() - INTERVAL '24 hours')::bigint,
        COUNT(observation.*) FILTER (WHERE observation.position_at >= NOW() - INTERVAL '7 days')::bigint,
        MIN(observation.position_at),
        MAX(observation.position_at)
      FROM delivery_eta_observations observation
      JOIN deliveries delivery ON delivery.id = observation.delivery_id
      WHERE delivery.company_id = ${companyId}

      UNION ALL

      SELECT
        'delivery_events'::text AS key,
        COUNT(event.*)::bigint,
        COUNT(event.*) FILTER (WHERE event.created_at >= NOW() - INTERVAL '24 hours')::bigint,
        COUNT(event.*) FILTER (WHERE event.created_at >= NOW() - INTERVAL '7 days')::bigint,
        MIN(event.created_at),
        MAX(event.created_at)
      FROM delivery_events event
      JOIN deliveries delivery ON delivery.id = event.delivery_id
      WHERE delivery.company_id = ${companyId}
    )
    SELECT * FROM metrics ORDER BY key
  ` as RawMetric[];

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    metrics: rows.map((row) => {
      const last24hRows = Number(row.last_24h_rows) || 0;
      const last7dRows = Number(row.last_7d_rows) || 0;
      return {
        key: row.key,
        totalRows: Number(row.total_rows) || 0,
        last24hRows,
        last7dRows,
        oldestAt: iso(row.oldest_at),
        newestAt: iso(row.newest_at),
        projected30dRows: project30dRows(last7dRows, last24hRows),
      };
    }),
  };
}
