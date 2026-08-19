import { neon } from "@neondatabase/serverless";

export type AutomationHeartbeat = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

let schemaPromise: Promise<void> | null = null;

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? neon(databaseUrl) : null;
}

async function ensureSchema() {
  const sql = sqlClient();
  if (!sql) return null;
  if (!schemaPromise) {
    schemaPromise = sql`CREATE TABLE IF NOT EXISTS automation_runtime_state (
      id text PRIMARY KEY,
      last_attempt_at timestamptz,
      last_success_at timestamptz,
      last_failure_at timestamptz
    )`.then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

export async function recordAutomationAttempt() {
  const sql = await ensureSchema();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at)
    VALUES ('fleet_tick', ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at`;
}

export async function recordAutomationSuccess() {
  const sql = await ensureSchema();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at)
    VALUES ('fleet_tick', ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_success_at = EXCLUDED.last_success_at`;
}

export async function recordAutomationFailure() {
  const sql = await ensureSchema();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES ('fleet_tick', ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_failure_at = EXCLUDED.last_failure_at`;
}

export async function getAutomationHeartbeat(): Promise<AutomationHeartbeat> {
  const sql = await ensureSchema();
  if (!sql) return { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
  const rows = await sql`SELECT last_attempt_at, last_success_at, last_failure_at
    FROM automation_runtime_state WHERE id = 'fleet_tick' LIMIT 1` as Array<{
      last_attempt_at: string | Date | null;
      last_success_at: string | Date | null;
      last_failure_at: string | Date | null;
    }>;
  const row = rows[0];
  return {
    lastAttemptAt: row?.last_attempt_at ? new Date(row.last_attempt_at) : null,
    lastSuccessAt: row?.last_success_at ? new Date(row.last_success_at) : null,
    lastFailureAt: row?.last_failure_at ? new Date(row.last_failure_at) : null,
  };
}
