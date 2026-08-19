import { runtimeEnv } from "trackfleet-runtime-env";
import { getD1StandbyReadiness, type D1ReadinessBinding } from "./d1-standby-readiness";

const enabledValues = new Set(["1", "true", "yes", "on", "enabled"]);

function configured() {
  const raw = runtimeEnv.TRACKFLEET_D1_READ_FAILOVER?.trim().toLowerCase() ?? "";
  return enabledValues.has(raw);
}

function d1Binding() {
  return (runtimeEnv as unknown as { DB?: D1ReadinessBinding }).DB ?? null;
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

export async function withD1ReadFailover<T>(
  scope: string,
  primaryRead: () => Promise<T>,
  standbyRead: () => Promise<T>,
): Promise<T> {
  try {
    return await primaryRead();
  } catch (primaryError) {
    if (!(await d1ReadFailoverReady())) throw primaryError;

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
