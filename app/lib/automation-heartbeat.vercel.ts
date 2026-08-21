import { neon } from "@neondatabase/serverless";

export type AutomationHeartbeat = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

export type RuntimeHeartbeatJob = "fleet_tick" | "telemetry_retention" | "notification_tick";
export type AutomationFailureCode =
  | "sendatrack_authentication_failed"
  | "sendatrack_service_unavailable"
  | "sendatrack_unexpected_response"
  | "sendatrack_not_configured"
  | "sendatrack_disconnected"
  | "automation_failed";

const automationFailureCodes: AutomationFailureCode[] = [
  "sendatrack_authentication_failed",
  "sendatrack_service_unavailable",
  "sendatrack_unexpected_response",
  "sendatrack_not_configured",
  "sendatrack_disconnected",
  "automation_failed",
];

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

export async function recordAutomationFailure(code: AutomationFailureCode = "automation_failed") {
  await recordRuntimeFailure("fleet_tick");
  const sql = sqlClient();
  if (!sql) return;
  const now = new Date().toISOString();
  const diagnosticId = `fleet_tick_failure:${code}`;
  await sql`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES (${diagnosticId}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_failure_at = EXCLUDED.last_failure_at`;
}

export async function getAutomationFailureCode(): Promise<AutomationFailureCode | null> {
  const sql = sqlClient();
  if (!sql) return null;
  const rows = await sql`SELECT id, last_failure_at
    FROM automation_runtime_state
    WHERE id LIKE 'fleet_tick_failure:%' AND last_failure_at IS NOT NULL
    ORDER BY last_failure_at DESC
    LIMIT 1` as Array<{ id: string; last_failure_at: string | Date | null }>;
  const id = rows[0]?.id ?? "";
  const code = id.startsWith("fleet_tick_failure:") ? id.slice("fleet_tick_failure:".length) : "";
  return automationFailureCodes.includes(code as AutomationFailureCode) ? code as AutomationFailureCode : null;
}

export function getAutomationHeartbeat() {
  return getRuntimeHeartbeat("fleet_tick");
}
