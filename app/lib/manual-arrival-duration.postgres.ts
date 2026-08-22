import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";
import {
  computeManualArrivalDurationEstimates,
  MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE,
  type ManualArrivalDurationEstimate,
  type ManualArrivalDurationSample,
} from "./manual-arrival-duration";

export type { ManualArrivalDurationEstimate } from "./manual-arrival-duration";

type RawRow = {
  destination_site_id: string;
  arrived_at: string | Date;
  started_at: string | Date;
};

export async function getManualArrivalDurationEstimates(companyId: string): Promise<Map<string, ManualArrivalDurationEstimate>> {
  const databaseUrl = runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return new Map();

  const sql = neon(databaseUrl);
  const rows = await sql`
    WITH matched AS (
      SELECT
        d.destination_site_id,
        arrival.created_at AS arrived_at,
        COALESCE(departure.created_at, d.created_at) AS started_at,
        ROW_NUMBER() OVER (PARTITION BY d.destination_site_id ORDER BY arrival.created_at DESC) AS recency_rank
      FROM deliveries d
      JOIN delivery_events arrival ON arrival.delivery_id = d.id AND arrival.type = 'MANUAL_ARRIVAL_CONFIRMED'
      LEFT JOIN delivery_events departure ON departure.delivery_id = d.id AND departure.type = 'DEPARTED'
      WHERE d.company_id = ${companyId} AND d.destination_site_id IS NOT NULL
    )
    SELECT destination_site_id, arrived_at, started_at
    FROM matched
    WHERE recency_rank <= ${MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE}
  ` as RawRow[];

  const samples: ManualArrivalDurationSample[] = rows.map((row) => ({
    destinationSiteId: row.destination_site_id,
    arrivedAt: new Date(row.arrived_at),
    startedAt: new Date(row.started_at),
  }));
  return computeManualArrivalDurationEstimates(samples);
}
