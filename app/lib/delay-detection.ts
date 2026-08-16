import type { EtaEstimate } from "./eta-estimator";

export const DEFAULT_DELAY_ALERT_MINUTES = 60;

export function shouldDetectDelay(input: {
  eta: EtaEstimate;
  delivered: boolean;
  alreadyDetected: boolean;
  thresholdMinutes?: number;
}) {
  const threshold = input.thresholdMinutes ?? DEFAULT_DELAY_ALERT_MINUTES;
  if (input.delivered || input.alreadyDetected) return false;
  if (input.eta.confidence !== "medium") return false;
  if (input.eta.delayMinutes === null) return false;
  return input.eta.delayMinutes >= threshold;
}
