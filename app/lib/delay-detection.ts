import type { EtaEstimate } from "./eta-estimator";

export const DEFAULT_DELAY_ALERT_MINUTES = 60;

export function shouldDetectDelay(input: {
  eta: EtaEstimate;
  delivered: boolean;
  alreadyDetected: boolean;
  thresholdMinutes?: number;
  // True when the destination is only reached via a local/relay leg our
  // GPS-tracked trucks never physically visit (see KnownSite.finalLegTrackingUnavailable).
  // The ETA/delay computed from a frozen last-known GPS position on that leg
  // is meaningless, so never raise a delay alert for it.
  finalLegTrackingUnavailable?: boolean;
}) {
  const threshold = input.thresholdMinutes ?? DEFAULT_DELAY_ALERT_MINUTES;
  if (input.finalLegTrackingUnavailable) return false;
  if (input.delivered || input.alreadyDetected) return false;
  if (input.eta.confidence !== "medium") return false;
  if (input.eta.delayMinutes === null) return false;
  return input.eta.delayMinutes >= threshold;
}
