import { neon } from "@neondatabase/serverless";

export type AutomationHeartbeat = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

export type RuntimeHeartbeatJob = "fleet_tick" | "telemetry_retention";

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? neon(databaseUrl) : null;
}

export async function recordRuntimeAttempt(jobId: RuntimeHeartbeatJob) {
  const sql = sqlClient();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at)
    VALUES (${jobId}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at`;
}

export async function recordRuntimeSuccess(jobId: RuntimeHeartbeatJob) {
  const sql = sqlClient();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at)
    VALUES (${jobId}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_success_at = EXCLUDED.last_success_at`;
}

export async function recordRuntimeFailure(jobId: RuntimeHeartbeatJob) {
  const sql = sqlClient();
  if (!sql) return;
  const now = new Date().toISOString();
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES (${jobId}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_failure_at = EXCLUDED.last_failure_at`;
}

export async function getRuntimeHeartbeat(jobId: RuntimeHeartbeatJob): Promise<AutomationHeartbeat> {
  const sql = sqlClient();
  if (!sql) return { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
  const rows = await sql`SELECT last_attempt_at, last_success_at, last_failure_at
    FROM automation_runtime_state WHERE id = ${jobId} LIMIT 1` as Array<{
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

export function recordAutomationAttempt() {
  return recordRuntimeAttempt("fleet_tick");
}

export function recordAutomationSuccess() {
  return recordRuntimeSuccess("fleet_tick");
}

export function recordAutomationFailure() {
  return recordRuntimeFailure("fleet_tick");
}

export function getAutomationHeartbeat() {
  return getRuntimeHeartbeat("fleet_tick");
}
