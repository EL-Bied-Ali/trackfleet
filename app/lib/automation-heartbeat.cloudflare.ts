import { runtimeEnv } from "trackfleet-runtime-env";

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

function database() {
  return runtimeEnv.DB ?? null;
}

export async function recordRuntimeAttempt(jobId: RuntimeHeartbeatJob) {
  const db = database();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`).bind(jobId, now).run();
}

export async function recordRuntimeSuccess(jobId: RuntimeHeartbeatJob) {
  const db = database();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at`)
    .bind(jobId, now, now).run();
}

export async function recordRuntimeFailure(jobId: RuntimeHeartbeatJob) {
  const db = database();
  if (!db) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at`)
    .bind(jobId, now, now).run();
}

export async function getRuntimeHeartbeat(jobId: RuntimeHeartbeatJob): Promise<AutomationHeartbeat> {
  const db = database();
  if (!db) return { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
  const row = await db.prepare(`SELECT last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt
    FROM automation_runtime_state WHERE id = ? LIMIT 1`).bind(jobId).first<{
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

export function recordAutomationAttempt() {
  return recordRuntimeAttempt("fleet_tick");
}

export function recordAutomationSuccess() {
  return recordRuntimeSuccess("fleet_tick");
}

export async function recordAutomationFailure(code: AutomationFailureCode = "automation_failed") {
  await recordRuntimeFailure("fleet_tick");
  const db = database();
  if (!db) return;
  const now = Date.now();
  const diagnosticId = `fleet_tick_failure:${code}`;
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at`)
    .bind(diagnosticId, now, now).run();
}

export async function getAutomationFailureCode(): Promise<AutomationFailureCode | null> {
  const db = database();
  if (!db) return null;
  const row = await db.prepare(`SELECT id FROM automation_runtime_state
    WHERE id LIKE 'fleet_tick_failure:%' AND last_failure_at IS NOT NULL
    ORDER BY last_failure_at DESC LIMIT 1`).first<{ id: string }>();
  const id = row?.id ?? "";
  const code = id.startsWith("fleet_tick_failure:") ? id.slice("fleet_tick_failure:".length) : "";
  return automationFailureCodes.includes(code as AutomationFailureCode) ? code as AutomationFailureCode : null;
}

export function getAutomationHeartbeat() {
  return getRuntimeHeartbeat("fleet_tick");
}
