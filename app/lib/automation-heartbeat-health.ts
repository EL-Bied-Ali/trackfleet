export const AUTOMATION_HEARTBEAT_STALE_AFTER_MS = 15 * 60_000;
export const RETENTION_HEARTBEAT_STALE_AFTER_MS = 36 * 60 * 60_000;

export function runtimeHeartbeatStatus(
  heartbeat: {
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  },
  staleAfterMs: number,
  now = new Date(),
) {
  const lastSuccessMs = heartbeat.lastSuccessAt?.getTime() ?? Number.NaN;
  const ageMs = Number.isFinite(lastSuccessMs) ? Math.max(0, now.getTime() - lastSuccessMs) : null;
  const fresh = ageMs !== null && ageMs <= staleAfterMs;
  return {
    fresh,
    lastAttemptAt: heartbeat.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: heartbeat.lastFailureAt?.toISOString() ?? null,
    successAgeSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    staleAfterSeconds: Math.floor(staleAfterMs / 1000),
  };
}

export function automationHeartbeatStatus(
  heartbeat: {
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  },
  now = new Date(),
) {
  return runtimeHeartbeatStatus(heartbeat, AUTOMATION_HEARTBEAT_STALE_AFTER_MS, now);
}

export function activeHeartbeatFailureCode<T>(
  heartbeat: { lastSuccessAt: string | null; lastFailureAt: string | null },
  failureCode: T | null,
) {
  if (!failureCode || !heartbeat.lastFailureAt) return null;
  if (heartbeat.lastSuccessAt && heartbeat.lastSuccessAt >= heartbeat.lastFailureAt) return null;
  return failureCode;
}

export function retentionHeartbeatStatus(
  heartbeat: {
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  },
  now = new Date(),
) {
  return runtimeHeartbeatStatus(heartbeat, RETENTION_HEARTBEAT_STALE_AFTER_MS, now);
}
