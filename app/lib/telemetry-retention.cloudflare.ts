import { runtimeEnv } from "trackfleet-runtime-env";
import { telemetryRetentionCutoff } from "./telemetry-retention";

export type TelemetryPruneResult = {
  ran: boolean;
  fleetPositions: number;
  tripPositions: number;
  etaObservations: number;
};

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
  if (existing && existing.lastPrunedAt >= staleBefore) {
    return { ran: false, fleetPositions: 0, tripPositions: 0, etaObservations: 0 };
  }

  const claim = await db.prepare(`INSERT INTO telemetry_retention_state (company_id, last_pruned_at)
    VALUES (?, ?)
    ON CONFLICT(company_id) DO UPDATE SET last_pruned_at = excluded.last_pruned_at
      WHERE telemetry_retention_state.last_pruned_at < ?`)
    .bind(companyId, nowMs, staleBefore).run();
  if (!claim.meta?.changes) return { ran: false, fleetPositions: 0, tripPositions: 0, etaObservations: 0 };

  const cutoff = telemetryRetentionCutoff(retentionDays, now).getTime();
  const results = await db.batch([
    db.prepare("DELETE FROM fleet_position_observations WHERE company_id = ? AND position_at < ?").bind(companyId, cutoff),
    db.prepare("DELETE FROM trip_position_observations WHERE company_id = ? AND position_at < ?").bind(companyId, cutoff),
    db.prepare(`DELETE FROM delivery_eta_observations
      WHERE position_at < ? AND delivery_id IN (SELECT id FROM deliveries WHERE company_id = ?)`)
      .bind(cutoff, companyId),
  ]);
  return {
    ran: true,
    fleetPositions: Number(results[0]?.meta?.changes ?? 0),
    tripPositions: Number(results[1]?.meta?.changes ?? 0),
    etaObservations: Number(results[2]?.meta?.changes ?? 0),
  };
}
