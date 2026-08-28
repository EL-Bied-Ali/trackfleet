import { knownSite } from "./known-sites.ts";
import { MANUAL_ARRIVAL_MINIMUM_SAMPLES } from "./manual-arrival-duration.ts";

// The two confirmed relay hubs (see known-sites.ts's relayHubSiteId) split
// the business's own quoted transit windows in two: agencies relayed via the
// Tanger Med hub (Tanger, Tétouan) get CTM's continuation north of Tangier,
// quoted at 5-7 days from departure; everywhere else relayed via Casablanca
// gets CTM's continuation from there, quoted at 10-13 days. Both windows
// collapse to their midpoint (rounded to a whole day) for a single stored
// estimate -- there's no live tracking on this leg to narrow it further (see
// finalLegTrackingUnavailable), so a point estimate is already an
// approximation regardless of which day within the window is picked.
//
// This is only the STARTING POINT, used until real data exists. Once at
// least MANUAL_ARRIVAL_MINIMUM_SAMPLES deliveries to a given agency have a
// confirmed door-to-door duration (see departure-arrival-duration.postgres.ts),
// callers should pass that learned median in instead -- what this specific
// agency has actually taken recently beats a fixed quote for the whole hub.
const relayTransitDaysByHub: Record<string, number> = {
  "tanger-med-ksar-al-majaz": 6,
  "casablanca-mohammed-vi-959": 12,
};

export type LearnedTransitEstimate = { medianHours: number; sampleCount: number } | null | undefined;

// null when the destination has no relay hub configured (a directly
// GPS-tracked destination, or one we simply don't have a quoted transit
// window for) -- callers should leave the arrival estimate blank rather than
// invent one.
export function estimateRelayArrival(destinationSiteId: string | null | undefined, departureAt: Date | null, learnedEstimate?: LearnedTransitEstimate): Date | null {
  if (!departureAt || !Number.isFinite(departureAt.getTime())) return null;
  const site = knownSite(destinationSiteId);
  const hubId = site?.relayHubSiteId;
  if (!hubId) return null;
  const transitHours = learnedEstimate && learnedEstimate.sampleCount >= MANUAL_ARRIVAL_MINIMUM_SAMPLES
    ? learnedEstimate.medianHours
    : (relayTransitDaysByHub[hubId] ?? 0) * 24;
  if (!transitHours) return null;
  return new Date(departureAt.getTime() + transitHours * 60 * 60_000);
}
