export const MIN_TELEMETRY_RETENTION_DAYS = 7;
export const MAX_TELEMETRY_RETENTION_DAYS = 3650;

export type TelemetryRetentionPolicy = {
  configured: boolean;
  valid: boolean;
  days: number | null;
};

export function telemetryRetentionPolicy(value?: string | null): TelemetryRetentionPolicy {
  const raw = value?.trim();
  if (!raw) return { configured: false, valid: true, days: null };
  if (!/^\d+$/.test(raw)) return { configured: true, valid: false, days: null };
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < MIN_TELEMETRY_RETENTION_DAYS || days > MAX_TELEMETRY_RETENTION_DAYS) {
    return { configured: true, valid: false, days: null };
  }
  return { configured: true, valid: true, days };
}

export function telemetryRetentionCutoff(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
