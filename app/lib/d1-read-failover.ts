import { runtimeEnv } from "trackfleet-runtime-env";
import { getD1StandbyReadiness } from "./d1-standby-readiness";

const enabledValues = new Set(["1", "true", "yes", "on", "enabled"]);
export const D1_READ_FAILOVER_LEASE_MS = 5 * 60_000;
let suppressionDepth = 0;

type D1FailoverStatement = {
  bind(...values: unknown[]): D1FailoverStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1FailoverBinding = {
  prepare(query: string): D1FailoverStatement;
};

function configured() {
  if (suppressionDepth > 0) return false;
  const raw = runtimeEnv.TRACKFLEET_D1_READ_FAILOVER?.trim().toLowerCase() ?? "";
  return enabledValues.has(raw);
}

function d1Binding() {
  return (runtimeEnv as unknown as { DB?: D1FailoverBinding }).DB ?? null;
}

export async function withoutD1ReadFailover<T>(operation: () => Promise<T>): Promise<T> {
  suppressionDepth += 1;
  try {
    return await operation();
  } finally {
    suppressionDepth -= 1;
  }
}

async function activateD1ReadFailover(db: D1FailoverBinding, now = Date.now()) {
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_success_at)
    VALUES ('d1_read_failover', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at`)
    .bind(now, now)
    .run();
}

export async function d1ReadFailoverReady() {
  if (!configured()) return false;
  const db = d1Binding();
  if (!db) return false;
  try {
    const readiness = await getD1StandbyReadiness(db);
    return readiness.ready;
  } catch (error) {
    console.error("[trackfleet:failover] failed to verify D1 standby readiness", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return false;
  }
}

export async function d1ReadFailoverActive(now = Date.now()) {
  if (!configured()) return false;
  const db = d1Binding();
  if (!db) return false;
  try {
    const row = await db.prepare(`SELECT last_success_at AS activated_at
      FROM automation_runtime_state WHERE id = 'd1_read_failover' LIMIT 1`)
      .first<{ activated_at: number | null }>();
    const activatedAt = Number(row?.activated_at ?? 0);
    return activatedAt > 0 && now - activatedAt <= D1_READ_FAILOVER_LEASE_MS;
  } catch {
    return false;
  }
}

async function approveAndActivateFailover() {
  if (!(await d1ReadFailoverReady())) return false;
  const db = d1Binding();
  if (!db) return false;
  try {
    await activateD1ReadFailover(db);
    return true;
  } catch (error) {
    console.error("[trackfleet:failover] failed to activate D1 read-only lease", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return false;
  }
}

export async function withD1ReadFailover<T>(
  scope: string,
  primaryRead: () => Promise<T>,
  standbyRead: () => Promise<T>,
): Promise<T> {
  try {
    return await primaryRead();
  } catch (primaryError) {
    if (!(await approveAndActivateFailover())) throw primaryError;

    console.warn("[trackfleet:failover] primary read failed; serving readiness-approved D1 standby", {
      scope,
      primaryMessage: primaryError instanceof Error ? primaryError.message : "unknown_error",
    });

    try {
      return await standbyRead();
    } catch (standbyError) {
      console.error("[trackfleet:failover] D1 standby read also failed", {
        scope,
        standbyMessage: standbyError instanceof Error ? standbyError.message : "unknown_error",
      });
      throw primaryError;
    }
  }
}

export async function suppressMaintenanceWriteDuringD1Failover<T>(
  scope: string,
  primaryWrite: () => Promise<T>,
  failoverValue: T,
): Promise<T> {
  try {
    return await primaryWrite();
  } catch (primaryError) {
    if (!(await approveAndActivateFailover())) throw primaryError;
    console.warn("[trackfleet:failover] primary maintenance write unavailable; preserving D1 as read-only", {
      scope,
      primaryMessage: primaryError instanceof Error ? primaryError.message : "unknown_error",
    });
    return failoverValue;
  }
}
