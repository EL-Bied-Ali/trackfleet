export const AUTOMATION_HEARTBEAT_STALE_AFTER_MS = 15 * 60_000;

export function automationHeartbeatStatus(
  heartbeat: {
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  },
  now = new Date(),
) {
  const lastSuccessMs = heartbeat.lastSuccessAt?.getTime() ?? Number.NaN;
  const ageMs = Number.isFinite(lastSuccessMs) ? Math.max(0, now.getTime() - lastSuccessMs) : null;
  const fresh = ageMs !== null && ageMs <= AUTOMATION_HEARTBEAT_STALE_AFTER_MS;
  return {
    fresh,
    lastAttemptAt: heartbeat.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: heartbeat.lastFailureAt?.toISOString() ?? null,
    successAgeSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    staleAfterSeconds: Math.floor(AUTOMATION_HEARTBEAT_STALE_AFTER_MS / 1000),
  };
}
