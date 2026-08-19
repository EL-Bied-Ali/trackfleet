import { neon } from "@neondatabase/serverless";
import { telemetryRetentionCutoff } from "./telemetry-retention";

export type TelemetryPruneResult = {
  ran: boolean;
  fleetPositions: number;
  tripPositions: number;
  etaObservations: number;
};

const maintenanceIntervalMs = 24 * 60 * 60 * 1000;
let schemaPromise: Promise<void> | null = null;

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for telemetry retention");
  return neon(databaseUrl);
}

async function ensureSchema() {
  const sql = sqlClient();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS telemetry_retention_state (
        company_id text PRIMARY KEY,
        last_pruned_at timestamptz NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_fleet_positions_company_time ON fleet_position_observations(company_id, position_at)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_trip_positions_company_time ON trip_position_observations(company_id, position_at)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

export async function pruneTelemetry(companyId: string, retentionDays: number, now = new Date()): Promise<TelemetryPruneResult> {
  const sql = await ensureSchema();
  const staleMaintenanceBefore = new Date(now.getTime() - maintenanceIntervalMs).toISOString();
  const claimed = await sql`INSERT INTO telemetry_retention_state (company_id, last_pruned_at)
    VALUES (${companyId}, ${now.toISOString()})
    ON CONFLICT (company_id) DO UPDATE SET last_pruned_at = EXCLUDED.last_pruned_at
      WHERE telemetry_retention_state.last_pruned_at < ${staleMaintenanceBefore}
    RETURNING company_id` as Array<{ company_id: string }>;
  if (!claimed.length) return { ran: false, fleetPositions: 0, tripPositions: 0, etaObservations: 0 };

  const cutoff = telemetryRetentionCutoff(retentionDays, now).toISOString();
  const [fleet, trip, eta] = await Promise.all([
    sql`WITH deleted AS (
      DELETE FROM fleet_position_observations WHERE company_id = ${companyId} AND position_at < ${cutoff} RETURNING 1
    ) SELECT count(*)::int AS count FROM deleted` as Promise<Array<{ count: number }>>,
    sql`WITH deleted AS (
      DELETE FROM trip_position_observations WHERE company_id = ${companyId} AND position_at < ${cutoff} RETURNING 1
    ) SELECT count(*)::int AS count FROM deleted` as Promise<Array<{ count: number }>>,
    sql`WITH deleted AS (
      DELETE FROM delivery_eta_observations
      WHERE position_at < ${cutoff}
        AND delivery_id IN (SELECT id FROM deliveries WHERE company_id = ${companyId})
      RETURNING 1
    ) SELECT count(*)::int AS count FROM deleted` as Promise<Array<{ count: number }>>,
  ]);
  return {
    ran: true,
    fleetPositions: Number(fleet[0]?.count ?? 0),
    tripPositions: Number(trip[0]?.count ?? 0),
    etaObservations: Number(eta[0]?.count ?? 0),
  };
}
