import type { TripPositionRow } from "./delivery-store.types.ts";
import { distanceKm } from "./route-progress.ts";

export type StopDwellStats = {
  tripCount: number;
  medianMinutes: number | null;
  usableMinutes: number | null;
};

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function midpoint(a: Date, b: Date) {
  return (a.getTime() + b.getTime()) / 2;
}

// Grouping positions by trip and sorting each trip by time doesn't depend
// on which site is being checked -- callers that need dwell stats for many
// sites against the same position history (see learnedStopMinutes in
// app/api/deliveries/route.ts, which runs this once per known company site)
// should group once with this and reuse it, instead of paying the
// grouping/sort cost again for every site. Reported live: this endpoint hit
// Cloudflare's Worker CPU time limit -- re-sorting a route's entire trip
// history (up to 20,000 positions) once per site was a real, avoidable
// contributor. A single-site caller (summarizeStopDwell below) pays this
// exact cost either way, so splitting it out changes nothing for them.
export function groupPositionsByTrip(positions: TripPositionRow[], excludeTripInstanceId: string | null = null): Map<string, TripPositionRow[]> {
  const byTrip = new Map<string, TripPositionRow[]>();
  for (const position of positions) {
    if (position.tripInstanceId === excludeTripInstanceId) continue;
    const rows = byTrip.get(position.tripInstanceId) ?? [];
    rows.push(position);
    byTrip.set(position.tripInstanceId, rows);
  }
  for (const rows of byTrip.values()) rows.sort((a, b) => a.positionAt.getTime() - b.positionAt.getTime());
  return byTrip;
}

export function summarizeStopDwellFromGroupedTrips(
  groupedTrips: Map<string, TripPositionRow[]>,
  site: { latitude: number; longitude: number; arrivalRadiusKm?: number },
  minimumTrips = 3,
): StopDwellStats {
  const radiusKm = Math.max(0.05, Math.min(10, site.arrivalRadiusKm ?? 0.5));
  const tripDurations: number[] = [];
  for (const ordered of groupedTrips.values()) {
    let previous: TripPositionRow | null = null;
    let enteredAt: number | null = null;
    let lastInside: TripPositionRow | null = null;
    const visits: number[] = [];

    for (const row of ordered) {
      const inside = distanceKm([row.longitude, row.latitude], [site.longitude, site.latitude]) <= radiusKm;
      if (inside) {
        if (enteredAt === null && previous) {
          const previousInside = distanceKm([previous.longitude, previous.latitude], [site.longitude, site.latitude]) <= radiusKm;
          if (!previousInside) enteredAt = midpoint(previous.positionAt, row.positionAt);
        }
        if (enteredAt !== null) lastInside = row;
      } else if (enteredAt !== null && lastInside) {
        const exitedAt = midpoint(lastInside.positionAt, row.positionAt);
        const durationMinutes = (exitedAt - enteredAt) / 60_000;
        if (durationMinutes >= 2 && durationMinutes <= 240) visits.push(durationMinutes);
        enteredAt = null;
        lastInside = null;
      }
      previous = row;
    }

    if (visits.length) tripDurations.push(Math.max(...visits));
  }

  const medianMinutes = median(tripDurations);
  const tripCount = tripDurations.length;
  const roundedMedian = medianMinutes === null ? null : Math.max(5, Math.min(180, Math.round(medianMinutes)));
  return {
    tripCount,
    medianMinutes: roundedMedian,
    usableMinutes: tripCount >= minimumTrips ? roundedMedian : null,
  };
}

export function summarizeStopDwell(
  positions: TripPositionRow[],
  site: { latitude: number; longitude: number; arrivalRadiusKm?: number },
  minimumTrips = 3,
  excludeTripInstanceId: string | null = null,
): StopDwellStats {
  return summarizeStopDwellFromGroupedTrips(groupPositionsByTrip(positions, excludeTripInstanceId), site, minimumTrips);
}
