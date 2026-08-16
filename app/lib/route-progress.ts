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
  // City-level fallbacks only. Exact agency coordinates override these points
  // as soon as a confirmed map pin is available.
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

export function routeForDestination(destination: string, explicitPoint?: [number, number] | null): Array<[number, number]> {
  const normalized = destination.trim().toUpperCase();
  const belgiumBound = isBelgiumDestination(normalized);
  const destinationPoint = destinationPointFor(destination, explicitPoint);

  if (belgiumBound) {
    const base = [...belgiumMoroccoCorridor].reverse();
    const exactIndex = base.findIndex((point) => samePoint(point, destinationPoint));
    if (exactIndex >= 0) return base.slice(0, exactIndex + 1);
    return appendIfDifferent(base, destinationPoint);
  }

  const base = [...belgiumMoroccoCorridor];
  const exactIndex = base.findIndex((point) => samePoint(point, destinationPoint));
  if (exactIndex >= 0) return base.slice(0, exactIndex + 1);

  // Morocco agencies branch from the shared Europe→Morocco corridor at the
  // nearest operational point. This avoids fictitious detours through
  // Casablanca for northern stops such as Tanger Med, Tétouan or Salé.
  if (includesAny(normalized, ["TANGER MED", "TANGIER MED", "KSAR AL MAJAZ"])) {
    return appendIfDifferent(base.slice(0, 5), destinationPoint); // branch after Algeciras
  }
  if (includesAny(normalized, ["TÉTOUAN", "TETOUAN"])) {
    return appendIfDifferent(base.slice(0, 6), destinationPoint); // branch after Tanger
  }
  if (includesAny(normalized, ["TANGIER", "TANGER"])) {
    return appendIfDifferent(base.slice(0, 6), destinationPoint);
  }
  if (includesAny(normalized, ["RABAT", "SALÉ", "SALE"])) {
    return appendIfDifferent(base.slice(0, 7), destinationPoint); // branch around Rabat/Salé
  }
  if (includesAny(normalized, ["AGADIR", "TIKIOUINE"])) {
    return appendIfDifferent(appendIfDifferent(base, MARRAKECH_FALLBACK), destinationPoint);
  }

  // Casablanca and the inland/southern branches share the corridor through
  // Casablanca before continuing to the selected agency.
  return appendIfDifferent(base, destinationPoint);
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
  return { t, distanceKm: distanceKm(point, projected) };
}

export function calculateRouteMetrics(
  latitude: number,
  longitude: number,
  destination: string,
  explicitDestination?: [number, number] | null,
): RouteMetrics {
  const route = routeForDestination(destination, explicitDestination);
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

export function deriveDeliveryState(
  currentStatus: "In transit" | "Delayed" | "Loading" | "Delivered",
  metrics: RouteMetrics,
  speed: number,
  previousProgress = 0,
  arrivalRadiusKm = 0.5,
  positionAgeMinutes = 0,
) {
  const safeArrivalRadiusKm = Math.max(0.05, Math.min(10, arrivalRadiusKm));
  const freshPosition = positionAgeMinutes <= 30;
  if (currentStatus === "Delivered" || (freshPosition && metrics.distanceToDestinationKm <= safeArrivalRadiusKm && speed <= 5)) {
    return { status: "Delivered" as const, progress: 100 };
  }
  const progress = Math.max(previousProgress, metrics.progress);
  if (currentStatus === "Delayed") return { status: currentStatus, progress };

  // A departure is a real movement away from the delivery baseline, not just a
  // noisy/stale GPS jump. One kilometre gives enough margin for manoeuvring in
  // a depot yard while >5 km/h confirms that the truck is actually moving.
  const movedBeyondDepartureZone = metrics.distanceFromOriginKm >= 1 || progress >= 1;
  if (currentStatus === "Loading" && freshPosition && movedBeyondDepartureZone && speed > 5) {
    return { status: "In transit" as const, progress };
  }
  if (currentStatus === "In transit") return { status: currentStatus, progress };
  return { status: "Loading" as const, progress };
}