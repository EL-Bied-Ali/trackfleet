import { neon } from "@neondatabase/serverless";
import {
  ETA_HISTORY_RETENTION_DAYS,
  HIGH_RESOLUTION_TELEMETRY_DAYS,
  TELEMETRY_DOWNSAMPLE_BUCKET_MINUTES,
  telemetryRetentionCutoff,
} from "./telemetry-retention";

export type TelemetryPruneResult = {
  ran: boolean;
  fleetPositions: number;
  tripPositions: number;
  etaObservations: number;
};

export type TelemetryPruneAllResult = TelemetryPruneResult & {
  companies: number;
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

  const highResolutionDays = Math.min(HIGH_RESOLUTION_TELEMETRY_DAYS, retentionDays);
  const rawCutoff = telemetryRetentionCutoff(retentionDays, now).toISOString();
  const highResolutionCutoff = telemetryRetentionCutoff(highResolutionDays, now).toISOString();
  const etaCutoff = telemetryRetentionCutoff(Math.max(ETA_HISTORY_RETENTION_DAYS, retentionDays), now).toISOString();
  const bucketSeconds = TELEMETRY_DOWNSAMPLE_BUCKET_MINUTES * 60;

  const fleet = await sql`WITH ranked AS (
      SELECT company_id, vehicle_id, position_at,
        row_number() OVER (
          PARTITION BY company_id, vehicle_id, floor(extract(epoch from position_at) / ${bucketSeconds})
          ORDER BY position_at
        ) AS rn
      FROM fleet_position_observations
      WHERE company_id = ${companyId}
        AND position_at >= ${rawCutoff}
        AND position_at < ${highResolutionCutoff}
    ), downsampled AS (
      DELETE FROM fleet_position_observations target
      USING ranked
      WHERE ranked.rn > 1
        AND target.company_id = ranked.company_id
        AND target.vehicle_id = ranked.vehicle_id
        AND target.position_at = ranked.position_at
      RETURNING 1
    ), expired AS (
      DELETE FROM fleet_position_observations
      WHERE company_id = ${companyId} AND position_at < ${rawCutoff}
      RETURNING 1
    )
    SELECT ((SELECT count(*) FROM downsampled) + (SELECT count(*) FROM expired))::int AS count` as Array<{ count: number }>;

  const trip = await sql`WITH ranked AS (
      SELECT company_id, trip_instance_id, position_at,
        row_number() OVER (
          PARTITION BY company_id, trip_instance_id, floor(extract(epoch from position_at) / ${bucketSeconds})
          ORDER BY position_at
        ) AS rn
      FROM trip_position_observations
      WHERE company_id = ${companyId}
        AND position_at >= ${rawCutoff}
        AND position_at < ${highResolutionCutoff}
    ), downsampled AS (
      DELETE FROM trip_position_observations target
      USING ranked
      WHERE ranked.rn > 1
        AND target.company_id = ranked.company_id
        AND target.trip_instance_id = ranked.trip_instance_id
        AND target.position_at = ranked.position_at
      RETURNING 1
    ), expired AS (
      DELETE FROM trip_position_observations
      WHERE company_id = ${companyId} AND position_at < ${rawCutoff}
      RETURNING 1
    )
    SELECT ((SELECT count(*) FROM downsampled) + (SELECT count(*) FROM expired))::int AS count` as Array<{ count: number }>;

  const eta = await sql`WITH deleted AS (
    DELETE FROM delivery_eta_observations
    WHERE position_at < ${etaCutoff}
      AND delivery_id IN (SELECT id FROM deliveries WHERE company_id = ${companyId})
    RETURNING 1
  ) SELECT count(*)::int AS count FROM deleted` as Array<{ count: number }>;

  return {
    ran: true,
    fleetPositions: Number(fleet[0]?.count ?? 0),
    tripPositions: Number(trip[0]?.count ?? 0),
    etaObservations: Number(eta[0]?.count ?? 0),
  };
}

export async function pruneAllTelemetry(retentionDays: number, now = new Date()): Promise<TelemetryPruneAllResult> {
  const sql = await ensureSchema();
  const rows = await sql`SELECT DISTINCT company_id FROM deliveries WHERE company_id IS NOT NULL AND company_id <> ''` as Array<{ company_id: string }>;
  let ran = false;
  let fleetPositions = 0;
  let tripPositions = 0;
  let etaObservations = 0;
  for (const row of rows) {
    const result = await pruneTelemetry(row.company_id, retentionDays, now);
    ran ||= result.ran;
    fleetPositions += result.fleetPositions;
    tripPositions += result.tripPositions;
    etaObservations += result.etaObservations;
  }
  return { ran, companies: rows.length, fleetPositions, tripPositions, etaObservations };
}
