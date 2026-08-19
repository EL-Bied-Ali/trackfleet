import { runtimeEnv } from "trackfleet-runtime-env";
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

export type TelemetryPruneAllResult = TelemetryPruneResult & { companies: number };

const maintenanceIntervalMs = 24 * 60 * 60 * 1000;

async function ensureSchema() {
  const db = runtimeEnv.DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is required for telemetry retention");
  await db.prepare(`CREATE TABLE IF NOT EXISTS telemetry_retention_state (
    company_id text PRIMARY KEY NOT NULL,
    last_pruned_at integer NOT NULL
  )`).run();
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_fleet_positions_company_time ON fleet_position_observations(company_id, position_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trip_positions_company_time ON trip_position_observations(company_id, position_at)"),
  ]);
  return db;
}

export async function pruneTelemetry(companyId: string, retentionDays: number, now = new Date()): Promise<TelemetryPruneResult> {
  const db = await ensureSchema();
  const nowMs = now.getTime();
  const staleBefore = nowMs - maintenanceIntervalMs;
  const existing = await db.prepare("SELECT last_pruned_at AS lastPrunedAt FROM telemetry_retention_state WHERE company_id = ? LIMIT 1")
    .bind(companyId).first<{ lastPrunedAt: number }>();
  if (existing && existing.lastPrunedAt >= staleBefore) return { ran: false, fleetPositions: 0, tripPositions: 0, etaObservations: 0 };

  const claim = await db.prepare(`INSERT INTO telemetry_retention_state (company_id, last_pruned_at)
    VALUES (?, ?)
    ON CONFLICT(company_id) DO UPDATE SET last_pruned_at = excluded.last_pruned_at
      WHERE telemetry_retention_state.last_pruned_at < ?`)
    .bind(companyId, nowMs, staleBefore).run();
  if (!claim.meta?.changes) return { ran: false, fleetPositions: 0, tripPositions: 0, etaObservations: 0 };

  const highResolutionDays = Math.min(HIGH_RESOLUTION_TELEMETRY_DAYS, retentionDays);
  const rawCutoff = telemetryRetentionCutoff(retentionDays, now).getTime();
  const highResolutionCutoff = telemetryRetentionCutoff(highResolutionDays, now).getTime();
  const etaCutoff = telemetryRetentionCutoff(Math.max(ETA_HISTORY_RETENTION_DAYS, retentionDays), now).getTime();
  const bucketMs = TELEMETRY_DOWNSAMPLE_BUCKET_MINUTES * 60 * 1000;

  const results = await db.batch([
    db.prepare(`DELETE FROM fleet_position_observations
      WHERE company_id = ? AND (
        position_at < ? OR rowid IN (
          SELECT rowid FROM (
            SELECT rowid, row_number() OVER (
              PARTITION BY company_id, vehicle_id, CAST(position_at / ? AS INTEGER)
              ORDER BY position_at
            ) AS rn
            FROM fleet_position_observations
            WHERE company_id = ? AND position_at >= ? AND position_at < ?
          ) ranked WHERE rn > 1
        )
      )`).bind(companyId, rawCutoff, bucketMs, companyId, rawCutoff, highResolutionCutoff),
    db.prepare(`DELETE FROM trip_position_observations
      WHERE company_id = ? AND (
        position_at < ? OR rowid IN (
          SELECT rowid FROM (
            SELECT rowid, row_number() OVER (
              PARTITION BY company_id, trip_instance_id, CAST(position_at / ? AS INTEGER)
              ORDER BY position_at
            ) AS rn
            FROM trip_position_observations
            WHERE company_id = ? AND position_at >= ? AND position_at < ?
          ) ranked WHERE rn > 1
        )
      )`).bind(companyId, rawCutoff, bucketMs, companyId, rawCutoff, highResolutionCutoff),
    db.prepare(`DELETE FROM delivery_eta_observations
      WHERE position_at < ? AND delivery_id IN (SELECT id FROM deliveries WHERE company_id = ?)`)
      .bind(etaCutoff, companyId),
  ]);

  return {
    ran: true,
    fleetPositions: Number(results[0]?.meta?.changes ?? 0),
    tripPositions: Number(results[1]?.meta?.changes ?? 0),
    etaObservations: Number(results[2]?.meta?.changes ?? 0),
  };
}

export async function pruneAllTelemetry(retentionDays: number, now = new Date()): Promise<TelemetryPruneAllResult> {
  const db = await ensureSchema();
  const { results = [] } = await db.prepare("SELECT DISTINCT company_id FROM deliveries WHERE company_id IS NOT NULL AND company_id <> ''").all<{ company_id: string }>();
  let ran = false;
  let fleetPositions = 0;
  let tripPositions = 0;
  let etaObservations = 0;
  for (const row of results) {
    const result = await pruneTelemetry(row.company_id, retentionDays, now);
    ran ||= result.ran;
    fleetPositions += result.fleetPositions;
    tripPositions += result.tripPositions;
    etaObservations += result.etaObservations;
  }
  return { ran, companies: results.length, fleetPositions, tripPositions, etaObservations };
}
