export type RouteMetrics = {
  progress: number;
  routeDistanceKm: number;
  completedDistanceKm: number;
  remainingDistanceKm: number;
  distanceFromOriginKm: number;
  distanceToDestinationKm: number;
};

export const belgiumMoroccoCorridor: Array<[number, number]> = [
  [4.3517, 50.8503], [2.3522, 48.8566], [-0.5792, 44.8378], [-3.7038, 40.4168],
  [-5.453, 36.1408], [-5.8128, 35.7673], [-6.8498, 33.9716], [-7.5898, 33.5731],
];

const MARRAKECH_FALLBACK: [number, number] = [-7.9811, 31.6295];

const knownDestinations: Array<{ names: string[]; point: [number, number] }> = [
  { names: ["CASABLANCA"], point: [-7.5898, 33.5731] },
  { names: ["RABAT", "SALÉ", "SALE"], point: [-6.7985, 34.0337] },
  { names: ["TANGER MED", "TANGIER MED", "KSAR AL MAJAZ"], point: [-5.5000, 35.8900] },
  { names: ["TANGIER", "TANGER"], point: [-5.8128, 35.7673] },
  { names: ["TÉTOUAN", "TETOUAN"], point: [-5.3626, 35.5889] },
  { names: ["MARRAKECH", "MARRAKESH"], point: MARRAKECH_FALLBACK },
  { names: ["AGADIR", "TIKIOUINE"], point: [-9.5981, 30.4278] },
  { names: ["KHOURIBGA"], point: [-6.9063, 32.8811] },
  { names: ["FQUIH BEN SALAH", "FQIH BEN SALAH"], point: [-6.6906, 32.5009] },
  { names: ["BRUSSELS", "BRUXELLES", "BRUSSEL"], point: [4.3517, 50.8503] },
  { names: ["ANTWERP", "ANTWERPEN", "ANVERS"], point: [4.4025, 51.2194] },
  { names: ["LIÈGE", "LIEGE", "LUIK"], point: [5.5797, 50.6326] },
];

function isBelgiumDestination(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.endsWith(", BE") || normalized.includes("BELGIQUE") || normalized.includes("BELGIUM");
}

function includesAny(value: string, names: string[]) {
  return names.some((name) => value.includes(name));
}

function radians(value: number) { return value * Math.PI / 180; }

export function distanceKm(a: [number, number], b: [number, number]) {
  const earthRadiusKm = 6371;
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const dLat = lat2 - lat1;
  const dLon = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destinationPointFor(destination: string, explicitPoint?: [number, number] | null): [number, number] {
  if (explicitPoint) return explicitPoint;
  const normalized = destination.trim().toUpperCase();
  const known = knownDestinations.find((candidate) => candidate.names.some((name) => normalized.includes(name)));
  if (known) return known.point;
  return isBelgiumDestination(normalized) ? belgiumMoroccoCorridor[0] : belgiumMoroccoCorridor.at(-1)!;
}

function samePoint(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
}

function appendIfDifferent(route: Array<[number, number]>, point: [number, number]) {
  return samePoint(route.at(-1)!, point) ? route : [...route, point];
}

function projectToSegment(point: [number, number], start: [number, number], end: [number, number]) {
  const referenceLat = radians((start[1] + end[1] + point[1]) / 3);
  const scaleX = Math.cos(referenceLat);
  const sx = start[0] * scaleX; const sy = start[1];
  const ex = end[0] * scaleX; const ey = end[1];
  const px = point[0] * scaleX; const py = point[1];
  const dx = ex - sx; const dy = ey - sy;
  const denominator = dx * dx + dy * dy;
  const rawT = denominator === 0 ? 0 : ((px - sx) * dx + (py - sy) * dy) / denominator;
  const t = Math.max(0, Math.min(1, rawT));
  const projected: [number, number] = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
  return { t, projected, distanceKm: distanceKm(point, projected) };
}

function trimRouteFromOrigin(route: Array<[number, number]>, origin?: [number, number] | null) {
  if (!origin || route.length < 2) return route;
  if (samePoint(origin, route[0])) return route;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProjection = route[0];

  for (let index = 0; index < route.length - 1; index += 1) {
    const projection = projectToSegment(origin, route[index], route[index + 1]);
    if (projection.distanceKm < bestDistance) {
      bestDistance = projection.distanceKm;
      bestIndex = index;
      bestProjection = projection.projected;
    }
  }

  const result: Array<[number, number]> = [origin];
  if (!samePoint(origin, bestProjection)) result.push(bestProjection);
  for (const point of route.slice(bestIndex + 1)) {
    if (!samePoint(result.at(-1)!, point)) result.push(point);
  }
  return result.length >= 2 ? result : [origin, route.at(-1)!];
}

export function routeForDestination(
  destination: string,
  explicitPoint?: [number, number] | null,
  explicitOrigin?: [number, number] | null,
): Array<[number, number]> {
  const normalized = destination.trim().toUpperCase();
  const belgiumBound = isBelgiumDestination(normalized);
  const destinationPoint = destinationPointFor(destination, explicitPoint);
  let route: Array<[number, number]>;

  if (belgiumBound) {
    const base = [...belgiumMoroccoCorridor].reverse();
    const exactIndex = base.findIndex((point) => samePoint(point, destinationPoint));
    route = exactIndex >= 0 ? base.slice(0, exactIndex + 1) : appendIfDifferent(base, destinationPoint);
    return trimRouteFromOrigin(route, explicitOrigin);
  }

  const base = [...belgiumMoroccoCorridor];
  const exactIndex = base.findIndex((point) => samePoint(point, destinationPoint));
  if (exactIndex >= 0) route = base.slice(0, exactIndex + 1);
  else if (includesAny(normalized, ["TANGER MED", "TANGIER MED", "KSAR AL MAJAZ"])) {
    route = appendIfDifferent(base.slice(0, 5), destinationPoint);
  } else if (includesAny(normalized, ["TÉTOUAN", "TETOUAN"])) {
    route = appendIfDifferent(base.slice(0, 6), destinationPoint);
  } else if (includesAny(normalized, ["TANGIER", "TANGER"])) {
    route = appendIfDifferent(base.slice(0, 6), destinationPoint);
  } else if (includesAny(normalized, ["RABAT", "SALÉ", "SALE"])) {
    route = appendIfDifferent(base.slice(0, 7), destinationPoint);
  } else if (includesAny(normalized, ["AGADIR", "TIKIOUINE"])) {
    route = appendIfDifferent(appendIfDifferent(base, MARRAKECH_FALLBACK), destinationPoint);
  } else {
    route = appendIfDifferent(base, destinationPoint);
  }

  return trimRouteFromOrigin(route, explicitOrigin);
}

export function calculateRouteMetrics(
  latitude: number,
  longitude: number,
  destination: string,
  explicitDestination?: [number, number] | null,
  explicitOrigin?: [number, number] | null,
): RouteMetrics {
  const route = routeForDestination(destination, explicitDestination, explicitOrigin);
  const point: [number, number] = [longitude, latitude];
  const segmentLengths = route.slice(0, -1).map((start, index) => distanceKm(start, route[index + 1]));
  const routeDistanceKm = segmentLengths.reduce((sum, value) => sum + value, 0);
  let bestDistance = Number.POSITIVE_INFINITY;
  let completedDistanceKm = 0;
  let distanceBeforeSegment = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const projection = projectToSegment(point, route[index], route[index + 1]);
    if (projection.distanceKm < bestDistance) {
      bestDistance = projection.distanceKm;
      completedDistanceKm = distanceBeforeSegment + segmentLengths[index] * projection.t;
    }
    distanceBeforeSegment += segmentLengths[index];
  }

  const originPoint = route[0];
  const destinationPoint = route.at(-1)!;
  const distanceFromOriginKm = distanceKm(point, originPoint);
  const distanceToDestinationKm = distanceKm(point, destinationPoint);
  const progress = routeDistanceKm > 0
    ? Math.max(0, Math.min(100, Math.round(completedDistanceKm / routeDistanceKm * 100)))
    : distanceToDestinationKm <= 0.5 ? 100 : 0;

  return { progress, routeDistanceKm, completedDistanceKm, remainingDistanceKm: Math.max(0, routeDistanceKm - completedDistanceKm), distanceFromOriginKm, distanceToDestinationKm };
}

export function rebaseRouteMetrics(metrics: RouteMetrics, baselineProgress: number): RouteMetrics {
  const baseline = Math.max(0, Math.min(99, baselineProgress));
  const baselineDistanceKm = metrics.routeDistanceKm * baseline / 100;
  const tripDistanceKm = Math.max(0, metrics.routeDistanceKm - baselineDistanceKm);
  const tripCompletedKm = Math.max(0, metrics.completedDistanceKm - baselineDistanceKm);
  const progress = tripDistanceKm > 0
    ? Math.max(0, Math.min(100, Math.round(tripCompletedKm / tripDistanceKm * 100)))
    : metrics.distanceToDestinationKm <= 0.5 ? 100 : 0;

  return {
    ...metrics,
    progress,
    routeDistanceKm: tripDistanceKm,
    completedDistanceKm: tripCompletedKm,
    remainingDistanceKm: Math.max(0, tripDistanceKm - tripCompletedKm),
    distanceFromOriginKm: tripCompletedKm,
  };
}

// Resolves the GPS_BASELINE progress to rebase a delivery's route metrics
// from, without a per-delivery DB round trip. `existingBaselineProgress` is
// whatever was already on record *before* this tick (batch-fetched once for
// every delivery up front, rather than queried individually per delivery --
// see delivery-store.postgres.ts's applySendatrackSnapshot for why that
// mattered for a production subrequest-limit incident). The one case that
// needs care: a delivery linking to GPS for the first time this tick
// (firstLink) always attempts to insert its own absoluteMetrics.progress as
// the baseline, but that insert is `ON CONFLICT (delivery_id, type) DO
// NOTHING` -- so if a baseline already existed (e.g. from an earlier
// linkVehicle call, or a prior link episode before this delivery's GPS
// source got reset), the insert silently no-ops and the pre-existing value
// must win, not the freshly computed one.
export function resolveGpsBaselineProgress(input: {
  existingBaselineProgress: number | undefined;
  firstLink: boolean;
  freshlyComputedProgress: number;
}): number {
  if (input.existingBaselineProgress !== undefined) return input.existingBaselineProgress;
  return input.firstLink ? input.freshlyComputedProgress : 0;
}

export function deriveDeliveryState(
  currentStatus: "In transit" | "Delayed" | "Loading" | "Delivered",
  metrics: RouteMetrics,
  speed: number,
  previousProgress = 0,
  _arrivalRadiusKm = 0.5,
  positionAgeMinutes = 0,
) {
  if (currentStatus === "Delivered") {
    return { status: "Delivered" as const, progress: 100 };
  }

  // GPS reaching the destination no longer finalizes a delivery immediately.
  // The completion layer requires a continuous unloading dwell (120 minutes by
  // default) or an authenticated manual completion. Keep active deliveries at
  // 99% until one of those completion paths confirms delivery.
  const progress = Math.min(99, Math.max(previousProgress, metrics.progress));
  if (currentStatus === "Delayed") return { status: currentStatus, progress };

  const freshPosition = positionAgeMinutes <= 30;
  const movedBeyondDepartureZone = metrics.distanceFromOriginKm >= 1 || progress >= 1;
  if (currentStatus === "Loading" && freshPosition && movedBeyondDepartureZone && speed > 5) {
    return { status: "In transit" as const, progress };
  }
  if (currentStatus === "In transit") return { status: currentStatus, progress };
  return { status: "Loading" as const, progress };
}
