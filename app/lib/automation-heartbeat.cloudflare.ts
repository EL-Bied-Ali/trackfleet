import { runtimeEnv } from "trackfleet-runtime-env";

export type AutomationHeartbeat = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

async function ensureTable() {
  const db = runtimeEnv.DB;
  if (!db) return null;
  await db.prepare(`CREATE TABLE IF NOT EXISTS automation_runtime_state (
    id text PRIMARY KEY NOT NULL,
    last_attempt_at integer,
    last_success_at integer,
    last_failure_at integer
  )`).run();
  return db;
}

export async function recordAutomationAttempt() {
  const db = await ensureTable();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at)
    VALUES ('fleet_tick', ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`).bind(now).run();
}

export async function recordAutomationSuccess() {
  const db = await ensureTable();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at)
    VALUES ('fleet_tick', ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at`)
    .bind(now, now).run();
}

export async function recordAutomationFailure() {
  const db = await ensureTable();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES ('fleet_tick', ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at`)
    .bind(now, now).run();
}

export async function getAutomationHeartbeat(): Promise<AutomationHeartbeat> {
  const db = await ensureTable();
  if (!db) return { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
  const row = await db.prepare(`SELECT last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt
    FROM automation_runtime_state WHERE id = 'fleet_tick' LIMIT 1`).first<{
      lastAttemptAt: number | null;
      lastSuccessAt: number | null;
      lastFailureAt: number | null;
    }>();
  return {
    lastAttemptAt: row?.lastAttemptAt ? new Date(row.lastAttemptAt) : null,
    lastSuccessAt: row?.lastSuccessAt ? new Date(row.lastSuccessAt) : null,
    lastFailureAt: row?.lastFailureAt ? new Date(row.lastFailureAt) : null,
  };
}
