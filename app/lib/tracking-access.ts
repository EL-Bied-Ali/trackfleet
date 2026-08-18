// Public tracking remains available for a short post-delivery support window,
// then becomes inaccessible without deleting the underlying delivery history.
export const TRACKING_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGACY_TRACKING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export function publicTrackingTokenIsValid(value: string) {
  return TRACKING_TOKEN_PATTERN.test(value);
}

export function trackingExpiresAt(input: { plannedArrivalAt: Date | null; createdAt: Date }) {
  const base = input.plannedArrivalAt?.getTime();
  if (typeof base === "number" && Number.isFinite(base)) {
    return new Date(base + TRACKING_GRACE_PERIOD_MS);
  }
  return new Date(input.createdAt.getTime() + LEGACY_TRACKING_LIFETIME_MS);
}

export function publicTrackingIsActive(
  input: { plannedArrivalAt: Date | null; createdAt: Date },
  now = new Date(),
) {
  return now.getTime() <= trackingExpiresAt(input).getTime();
}
