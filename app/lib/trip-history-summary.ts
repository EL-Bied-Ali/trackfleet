import type { TripRecord } from "./trip-record";

export type TripRouteHistorySummary = {
  routeTemplateId: string;
  originSiteId: string | null;
  destinationSiteIds: string[];
  destinations: string[];
  tripCount: number;
  trucks: string[];
  lastCompletedAt: Date;
};

function routeIdentity(trip: TripRecord) {
  const orderedStops = [...trip.stops].sort((a, b) => a.sequence - b.sequence);
  return `${trip.routeTemplateId}|${trip.originSiteId ?? ""}|${orderedStops.map((stop) => stop.siteId).join(">")}`;
}

export function summarizeCompletedTripRoutes(trips: TripRecord[]): TripRouteHistorySummary[] {
  const summaries = new Map<string, TripRouteHistorySummary>();

  for (const trip of trips) {
    if (trip.status !== "completed") continue;
    const orderedStops = [...trip.stops].sort((a, b) => a.sequence - b.sequence);
    if (!orderedStops.length) continue;

    const key = routeIdentity(trip);
    const existing = summaries.get(key);
    if (!existing) {
      summaries.set(key, {
        routeTemplateId: trip.routeTemplateId,
        originSiteId: trip.originSiteId,
        destinationSiteIds: orderedStops.map((stop) => stop.siteId),
        destinations: orderedStops.map((stop) => stop.destination),
        tripCount: 1,
        trucks: trip.truck ? [trip.truck] : [],
        lastCompletedAt: trip.updatedAt,
      });
      continue;
    }

    existing.tripCount += 1;
    if (trip.truck && !existing.trucks.includes(trip.truck)) existing.trucks.push(trip.truck);
    if (trip.updatedAt > existing.lastCompletedAt) existing.lastCompletedAt = trip.updatedAt;
  }

  return [...summaries.values()].sort((a, b) => {
    if (b.tripCount !== a.tripCount) return b.tripCount - a.tripCount;
    return b.lastCompletedAt.getTime() - a.lastCompletedAt.getTime();
  });
}
