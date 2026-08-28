import { knownSite } from "./known-sites.ts";

// The two confirmed relay hubs (see known-sites.ts's relayHubSiteId) split
// the business's own quoted transit windows in two: agencies relayed via the
// Tanger Med hub (Tanger, Tétouan) get CTM's continuation north of Tangier,
// quoted at 5-7 days from departure; everywhere else relayed via Casablanca
// gets CTM's continuation from there, quoted at 10-13 days. Both windows
// collapse to their midpoint (rounded to a whole day) for a single stored
// estimate -- there's no live tracking on this leg to narrow it further (see
// finalLegTrackingUnavailable), so a point estimate is already an
// approximation regardless of which day within the window is picked.
const relayTransitDaysByHub: Record<string, number> = {
  "tanger-med-ksar-al-majaz": 6,
  "casablanca-mohammed-vi-959": 12,
};

// null when the destination has no relay hub configured (a directly
// GPS-tracked destination, or one we simply don't have a quoted transit
// window for) -- callers should leave the arrival estimate blank rather than
// invent one.
export function estimateRelayArrival(destinationSiteId: string | null | undefined, departureAt: Date | null): Date | null {
  if (!departureAt || !Number.isFinite(departureAt.getTime())) return null;
  const site = knownSite(destinationSiteId);
  const hubId = site?.relayHubSiteId;
  if (!hubId) return null;
  const transitDays = relayTransitDaysByHub[hubId];
  if (!transitDays) return null;
  return new Date(departureAt.getTime() + transitDays * 24 * 60 * 60_000);
}
