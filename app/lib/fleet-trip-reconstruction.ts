import type { FleetPositionRow } from "./delivery-store.types";

export type FleetHistorySite = {
  id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  arrivalRadiusKm: number;
};

export type FleetReconstructionOptions = {
  movingSpeedKmh?: number;
  stopRadiusKm?: number;
  minimumStopMinutes?: number;
  minimumTripDistanceKm?: number;
  maximumPlausibleSpeedKmh?: number;
  maximumContinuityGapMinutes?: number;
};

export type ReconstructedStop = {
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
  latitude: number;
  longitude: number;
  pointCount: number;
  address: string;
  siteId: string | null;
  siteLabel: string | null;
  siteDistanceKm: number | null;
};

export type ReconstructedTrip = {
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
  distanceKm: number;
  pointCount: number;
  maximumSpeedKmh: number;
  originStopIndex: number | null;
  destinationStopIndex: number | null;
  originSiteId: string | null;
  destinationSiteId: string | null;
  openStart: boolean;
  openEnd: boolean;
};

export type FleetReconstruction = {
  points: FleetPositionRow[];
  stops: ReconstructedStop[];
  trips: ReconstructedTrip[];
  summary: {
    pointCount: number;
    startedAt: Date | null;
    endedAt: Date | null;
    observedDurationMinutes: number;
    distanceKm: number;
    movingMinutes: number;
    stationaryMinutes: number;
    unclassifiedGapMinutes: number;
    dataGapCount: number;
    discardedJumpCount: number;
  };
};

const EARTH_RADIUS_KM = 6371.0088;

function radians(value: number) {
  return value * Math.PI / 180;
}

export function haversineKm(
  left: Pick<FleetPositionRow, "latitude" | "longitude">,
  right: Pick<FleetPositionRow, "latitude" | "longitude">,
) {
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(right.longitude - left.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanPoints(rows: FleetPositionRow[]) {
  const byTimestamp = new Map<number, FleetPositionRow>();
  for (const row of rows) {
    const timestamp = row.positionAt.getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) continue;
    byTimestamp.set(timestamp, row);
  }
  return [...byTimestamp.values()].sort((a, b) => a.positionAt.getTime() - b.positionAt.getTime());
}

function mostFrequentAddress(points: FleetPositionRow[]) {
  const counts = new Map<string, number>();
  for (const point of points) {
    const address = point.address.trim();
    if (!address) continue;
    counts.set(address, (counts.get(address) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function nearestSite(latitude: number, longitude: number, sites: FleetHistorySite[]) {
  let nearest: { site: FleetHistorySite; distanceKm: number } | null = null;
  for (const site of sites) {
    if (typeof site.latitude !== "number" || typeof site.longitude !== "number") continue;
    const distanceKm = haversineKm({ latitude, longitude }, { latitude: site.latitude, longitude: site.longitude });
    const acceptedRadiusKm = Math.max(0.2, site.arrivalRadiusKm);
    if (distanceKm > acceptedRadiusKm) continue;
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { site, distanceKm };
  }
  return nearest;
}

function finalizeStop(
  candidate: FleetPositionRow[],
  sites: FleetHistorySite[],
  minimumStopMinutes: number,
): ReconstructedStop | null {
  if (candidate.length < 2) return null;
  const startedAt = candidate[0].positionAt;
  const endedAt = candidate[candidate.length - 1].positionAt;
  const durationMinutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60_000);
  if (durationMinutes < minimumStopMinutes) return null;
  const latitude = candidate.reduce((sum, point) => sum + point.latitude, 0) / candidate.length;
  const longitude = candidate.reduce((sum, point) => sum + point.longitude, 0) / candidate.length;
  const matchedSite = nearestSite(latitude, longitude, sites);
  return {
    startedAt,
    endedAt,
    durationMinutes: rounded(durationMinutes, 1),
    latitude: rounded(latitude, 6),
    longitude: rounded(longitude, 6),
    pointCount: candidate.length,
    address: mostFrequentAddress(candidate),
    siteId: matchedSite?.site.id ?? null,
    siteLabel: matchedSite?.site.label ?? null,
    siteDistanceKm: matchedSite ? rounded(matchedSite.distanceKm, 3) : null,
  };
}

function reconstructStops(
  points: FleetPositionRow[],
  sites: FleetHistorySite[],
  movingSpeedKmh: number,
  stopRadiusKm: number,
  minimumStopMinutes: number,
  maximumContinuityGapMinutes: number,
) {
  const stops: ReconstructedStop[] = [];
  let candidate: FleetPositionRow[] = [];

  const flush = () => {
    const stop = finalizeStop(candidate, sites, minimumStopMinutes);
    if (stop) stops.push(stop);
    candidate = [];
  };

  for (const point of points) {
    if (point.speed >= movingSpeedKmh) {
      flush();
      continue;
    }
    if (!candidate.length) {
      candidate = [point];
      continue;
    }
    const previous = candidate[candidate.length - 1];
    const gapMinutes = (point.positionAt.getTime() - previous.positionAt.getTime()) / 60_000;
    const anchor = candidate[0];
    const distanceFromAnchorKm = haversineKm(anchor, point);
    if (gapMinutes > maximumContinuityGapMinutes || distanceFromAnchorKm > stopRadiusKm) {
      flush();
      candidate = [point];
      continue;
    }
    candidate.push(point);
  }
  flush();
  return stops;
}

function pathMetrics(points: FleetPositionRow[], maximumPlausibleSpeedKmh: number) {
  let distanceKm = 0;
  let discardedJumpCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsedHours = (current.positionAt.getTime() - previous.positionAt.getTime()) / 3_600_000;
    if (!(elapsedHours > 0)) continue;
    const segmentDistanceKm = haversineKm(previous, current);
    const impliedSpeedKmh = segmentDistanceKm / elapsedHours;
    if (impliedSpeedKmh > maximumPlausibleSpeedKmh) {
      discardedJumpCount += 1;
      continue;
    }
    distanceKm += segmentDistanceKm;
  }
  return { distanceKm, discardedJumpCount };
}

function pointsWithin(points: FleetPositionRow[], from: Date, to: Date) {
  const fromTime = from.getTime();
  const toTime = to.getTime();
  return points.filter((point) => {
    const timestamp = point.positionAt.getTime();
    return timestamp >= fromTime && timestamp <= toTime;
  });
}

function buildTrip(
  points: FleetPositionRow[],
  originStopIndex: number | null,
  destinationStopIndex: number | null,
  stops: ReconstructedStop[],
  minimumTripDistanceKm: number,
  maximumPlausibleSpeedKmh: number,
): ReconstructedTrip | null {
  if (points.length < 2) return null;
  const metrics = pathMetrics(points, maximumPlausibleSpeedKmh);
  if (metrics.distanceKm < minimumTripDistanceKm) return null;
  const startedAt = points[0].positionAt;
  const endedAt = points[points.length - 1].positionAt;
  return {
    startedAt,
    endedAt,
    durationMinutes: rounded(Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60_000), 1),
    distanceKm: rounded(metrics.distanceKm),
    pointCount: points.length,
    maximumSpeedKmh: rounded(Math.max(...points.map((point) => point.speed), 0), 1),
    originStopIndex,
    destinationStopIndex,
    originSiteId: originStopIndex === null ? null : stops[originStopIndex]?.siteId ?? null,
    destinationSiteId: destinationStopIndex === null ? null : stops[destinationStopIndex]?.siteId ?? null,
    openStart: originStopIndex === null,
    openEnd: destinationStopIndex === null,
  };
}

function reconstructTrips(
  points: FleetPositionRow[],
  stops: ReconstructedStop[],
  minimumTripDistanceKm: number,
  maximumPlausibleSpeedKmh: number,
) {
  if (points.length < 2) return [];
  const trips: ReconstructedTrip[] = [];

  if (!stops.length) {
    const trip = buildTrip(points, null, null, stops, minimumTripDistanceKm, maximumPlausibleSpeedKmh);
    return trip ? [trip] : [];
  }

  const firstStop = stops[0];
  const beforeFirst = pointsWithin(points, points[0].positionAt, firstStop.startedAt);
  const openStartTrip = buildTrip(beforeFirst, null, 0, stops, minimumTripDistanceKm, maximumPlausibleSpeedKmh);
  if (openStartTrip) trips.push(openStartTrip);

  for (let index = 0; index < stops.length - 1; index += 1) {
    const origin = stops[index];
    const destination = stops[index + 1];
    const between = pointsWithin(points, origin.endedAt, destination.startedAt);
    const trip = buildTrip(between, index, index + 1, stops, minimumTripDistanceKm, maximumPlausibleSpeedKmh);
    if (trip) trips.push(trip);
  }

  const lastStopIndex = stops.length - 1;
  const afterLast = pointsWithin(points, stops[lastStopIndex].endedAt, points[points.length - 1].positionAt);
  const openEndTrip = buildTrip(afterLast, lastStopIndex, null, stops, minimumTripDistanceKm, maximumPlausibleSpeedKmh);
  if (openEndTrip) trips.push(openEndTrip);
  return trips;
}

export function reconstructFleetTrips(
  rows: FleetPositionRow[],
  sites: FleetHistorySite[] = [],
  options: FleetReconstructionOptions = {},
): FleetReconstruction {
  const movingSpeedKmh = options.movingSpeedKmh ?? 5;
  const stopRadiusKm = options.stopRadiusKm ?? 0.3;
  const minimumStopMinutes = options.minimumStopMinutes ?? 15;
  const minimumTripDistanceKm = options.minimumTripDistanceKm ?? 1;
  const maximumPlausibleSpeedKmh = options.maximumPlausibleSpeedKmh ?? 180;
  const maximumContinuityGapMinutes = options.maximumContinuityGapMinutes ?? 30;
  const points = cleanPoints(rows);
  const stops = reconstructStops(points, sites, movingSpeedKmh, stopRadiusKm, minimumStopMinutes, maximumContinuityGapMinutes);
  const trips = reconstructTrips(points, stops, minimumTripDistanceKm, maximumPlausibleSpeedKmh);
  const path = pathMetrics(points, maximumPlausibleSpeedKmh);

  let movingMinutes = 0;
  let stationaryMinutes = 0;
  let unclassifiedGapMinutes = 0;
  let dataGapCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsedMinutes = (current.positionAt.getTime() - previous.positionAt.getTime()) / 60_000;
    if (!(elapsedMinutes > 0)) continue;
    if (elapsedMinutes > maximumContinuityGapMinutes) {
      dataGapCount += 1;
      unclassifiedGapMinutes += elapsedMinutes;
      continue;
    }
    const distanceKm = haversineKm(previous, current);
    const displacementSpeedKmh = distanceKm / (elapsedMinutes / 60);
    const moving = Math.max(previous.speed, current.speed, displacementSpeedKmh) >= movingSpeedKmh;
    if (moving) movingMinutes += elapsedMinutes;
    else stationaryMinutes += elapsedMinutes;
  }

  return {
    points,
    stops,
    trips,
    summary: {
      pointCount: points.length,
      startedAt: points[0]?.positionAt ?? null,
      endedAt: points.at(-1)?.positionAt ?? null,
      observedDurationMinutes: points.length > 1 ? rounded((points.at(-1)!.positionAt.getTime() - points[0].positionAt.getTime()) / 60_000, 1) : 0,
      distanceKm: rounded(path.distanceKm),
      movingMinutes: rounded(movingMinutes, 1),
      stationaryMinutes: rounded(stationaryMinutes, 1),
      unclassifiedGapMinutes: rounded(unclassifiedGapMinutes, 1),
      dataGapCount,
      discardedJumpCount: path.discardedJumpCount,
    },
  };
}
