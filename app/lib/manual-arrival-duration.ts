import { distanceKm } from "./route-progress.ts";

export type ManualArrivalDurationEstimate = {
  medianHours: number;
  sampleCount: number;
};

export type ManualArrivalDurationSample = {
  destinationSiteId: string;
  arrivedAt: Date;
  startedAt: Date;
};

export type RelayPassageCandidate = {
  deliveryId: string;
  destinationSiteId: string;
  arrivedAt: Date;
  fallbackStartedAt: Date;
  positionAt: Date | null;
  latitude: number | null;
  longitude: number | null;
};

export type RelayHubConfig = {
  hubLongitude: number;
  hubLatitude: number;
  vicinityRadiusKm: number;
};

// How many of the most recent manually-confirmed arrivals per destination
// site to use for the estimate. Bounded and recency-weighted on purpose:
// operational patterns (which regional truck runs a route, typical loads)
// drift over time, so a rolling recent sample is more useful for a rough
// "how long does this usually take" figure than an all-time average.
export const MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE = 10;
export const MANUAL_ARRIVAL_MINIMUM_SAMPLES = 2;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Employee-confirmed arrival duration per destination site, computed from
// the DEPARTED event (or delivery creation, if the truck never had GPS to
// depart from) to the MANUAL_ARRIVAL_CONFIRMED event. Built for destinations
// where live GPS tracking stops short (see KnownSite.finalLegTrackingUnavailable
// in known-sites.ts) so the app can still offer customers and dispatchers a
// rough "usually about N days" estimate instead of nothing at all -- an
// exact date was never the goal, only a useful approximation that improves
// as more employees confirm real arrivals over time.
export function computeManualArrivalDurationEstimates(samples: ManualArrivalDurationSample[]): Map<string, ManualArrivalDurationEstimate> {
  const durationsBySite = new Map<string, number[]>();
  for (const sample of samples) {
    const arrivedAt = sample.arrivedAt.getTime();
    const startedAt = sample.startedAt.getTime();
    if (!Number.isFinite(arrivedAt) || !Number.isFinite(startedAt) || arrivedAt <= startedAt) continue;
    const hours = (arrivedAt - startedAt) / 3_600_000;
    const existing = durationsBySite.get(sample.destinationSiteId) ?? [];
    existing.push(hours);
    durationsBySite.set(sample.destinationSiteId, existing);
  }

  const estimates = new Map<string, ManualArrivalDurationEstimate>();
  for (const [siteId, durations] of durationsBySite) {
    if (durations.length < MANUAL_ARRIVAL_MINIMUM_SAMPLES) continue;
    estimates.set(siteId, { medianHours: Math.round(median(durations) * 10) / 10, sampleCount: durations.length });
  }
  return estimates;
}

// Picks the real start of the unknown leg for each delivery: the latest GPS
// position seen within vicinityRadiusKm of its destination's relay hub,
// during the [fallbackStartedAt, arrivedAt] window. Falls back to
// fallbackStartedAt (the whole door-to-door journey) when no hub is
// configured for that destination, or no GPS evidence near it was found --
// e.g. sparse telemetry, or a route that genuinely never passed through it.
export function resolveManualArrivalSamples(
  candidates: RelayPassageCandidate[],
  hubConfigByDestination: Map<string, RelayHubConfig>,
): ManualArrivalDurationSample[] {
  const byDelivery = new Map<string, RelayPassageCandidate[]>();
  for (const candidate of candidates) {
    const existing = byDelivery.get(candidate.deliveryId) ?? [];
    existing.push(candidate);
    byDelivery.set(candidate.deliveryId, existing);
  }

  const samples: ManualArrivalDurationSample[] = [];
  for (const rows of byDelivery.values()) {
    const first = rows[0];
    const hub = hubConfigByDestination.get(first.destinationSiteId) ?? null;

    let lastSeenAtRelay: Date | null = null;
    if (hub) {
      const hubPoint: [number, number] = [hub.hubLongitude, hub.hubLatitude];
      for (const row of rows) {
        if (row.positionAt === null || row.latitude === null || row.longitude === null) continue;
        if (distanceKm([row.longitude, row.latitude], hubPoint) > hub.vicinityRadiusKm) continue;
        if (!lastSeenAtRelay || row.positionAt.getTime() > lastSeenAtRelay.getTime()) lastSeenAtRelay = row.positionAt;
      }
    }

    samples.push({
      destinationSiteId: first.destinationSiteId,
      arrivedAt: first.arrivedAt,
      startedAt: lastSeenAtRelay ?? first.fallbackStartedAt,
    });
  }
  return samples;
}
