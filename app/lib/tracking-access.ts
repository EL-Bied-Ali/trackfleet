// Public tracking remains available for a short post-delivery support window,
// then becomes inaccessible without deleting the underlying delivery history.
export const TRACKING_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGACY_TRACKING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
// Once the delivery has actually arrived (not merely "planned to"), the
// 7-day-post-planned-arrival window above is far more generous than needed
// -- this tightens it to a short grace window from the real arrival, per
// the privacy policy's "expire après son arrivée" and the product decision
// to cut the link short once the agency has confirmed/notified the
// recipient, rather than leaving it live for up to a week regardless.
export const POST_ARRIVAL_GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;
const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export function publicTrackingTokenIsValid(value: string) {
  return TRACKING_TOKEN_PATTERN.test(value);
}

export function trackingExpiresAt(input: { plannedArrivalAt: Date | null; createdAt: Date; deliveredAt?: Date | null }) {
  const base = input.plannedArrivalAt?.getTime();
  const planned = typeof base === "number" && Number.isFinite(base)
    ? new Date(base + TRACKING_GRACE_PERIOD_MS)
    : new Date(input.createdAt.getTime() + LEGACY_TRACKING_LIFETIME_MS);
  if (!input.deliveredAt) return planned;
  const postArrival = new Date(input.deliveredAt.getTime() + POST_ARRIVAL_GRACE_PERIOD_MS);
  return postArrival.getTime() < planned.getTime() ? postArrival : planned;
}

export function publicTrackingIsActive(
  input: { plannedArrivalAt: Date | null; createdAt: Date; deliveredAt?: Date | null },
  now = new Date(),
) {
  return now.getTime() <= trackingExpiresAt(input).getTime();
}
