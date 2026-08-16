export type RouteMetrics = {
  progress: number;
  routeDistanceKm: number;
  completedDistanceKm: number;
  remainingDistanceKm: number;
  distanceToDestinationKm: number;
};

// Shared Belgium ↔ Morocco corridor used by the map. Coordinates are [longitude, latitude].
export const belgiumMoroccoCorridor: Array<[number, number]> = [
  [4.3517, 50.8503], // Brussels
  [2.3522, 48.8566], // Paris
  [-0.5792, 44.8378], // Bordeaux
  [-3.7038, 40.4168], // Madrid
  [-5.453, 36.1408], // Algeciras
  [-5.8128, 35.7673], // Tangier
  [-6.8498, 33.9716], // Rabat
  [-7.5898, 33.5731], // Casablanca
];

const knownDestinations: Array<{ names: string[]; point: [number, number] }> = [
  { names: ["CASABLANCA"], point: [-7.5898, 33.5731] },
  { names: ["RABAT"], point: [-6.8498, 33.9716] },
  { names: ["TANGIER", "TANGER"], point: [-5.8128, 35.7673] },
  { names: ["BRUSSELS", "BRUXELLES", "BRUSSEL"], point: [4.3517, 50.8503] },
  { names: ["ANTWERP", "ANTWERPEN", "ANVERS"], point: [4.4025, 51.2194] },
  { names: ["LIÈGE", "LIEGE", "LUIK"], point: [5.5797, 50.6326] },
];

function radians(value: number) {
  return value * Math.PI / 180;
}

export function distanceKm(a: [number, number], b: [number, number]) {
  const earthRadiusKm = 6371;
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const dLat = lat2 - lat1;
  const dLon = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destinationPointFor(destination: string): [number, number] {
  const normalized = destination.trim().toUpperCase();
  const known = knownDestinations.find((candidate) => candidate.names.some((name) => normalized.includes(name)));
  if (known) return known.point;
  return normalized.endsWith(", BE") ? belgiumMoroccoCorridor[0] : belgiumMoroccoCorridor.at(-1)!;
}

function samePoint(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
}

export function routeForDestination(destination: string): Array<[number, number]> {
  const normalized = destination.trim().toUpperCase();
  const belgiumBound = normalized.endsWith(", BE");
  const base = belgiumBound ? [...belgiumMoroccoCorridor].reverse() : [...belgiumMoroccoCorridor];
  const destinationPoint = destinationPointFor(destination);

  // If the destination lies on the known corridor (for example Tangier or Rabat),
  // stop the route there rather than continuing to the old default endpoint.
  const exactIndex = base.findIndex((point) => samePoint(point, destinationPoint));
  if (exactIndex >= 0) return base.slice(0, exactIndex + 1);

  // Belgian destinations such as Antwerp and Liège branch from Brussels. For
  // destinations not represented by a corridor waypoint, append the real point.
  return [...base, destinationPoint];
}

function projectToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  // Equirectangular projection is accurate enough for choosing the closest point
  // on these relatively short route segments. Distances themselves use haversine.
  const referenceLat = radians((start[1] + end[1] + point[1]) / 3);
  const scaleX = Math.cos(referenceLat);
  const sx = start[0] * scaleX;
  const sy = start[1];
  const ex = end[0] * scaleX;
  const ey = end[1];
  const px = point[0] * scaleX;
  const py = point[1];
  const dx = ex - sx;
  const dy = ey - sy;
  const denominator = dx * dx + dy * dy;
  const rawT = denominator === 0 ? 0 : ((px - sx) * dx + (py - sy) * dy) / denominator;
  const t = Math.max(0, Math.min(1, rawT));
  const projected: [number, number] = [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
  return { t, projected, distanceKm: distanceKm(point, projected) };
}

export function calculateRouteMetrics(
  latitude: number,
  longitude: number,
  destination: string,
): RouteMetrics {
  const route = routeForDestination(destination);
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

  const destinationPoint = route.at(-1)!;
  const distanceToDestinationKm = distanceKm(point, destinationPoint);
  const progress = routeDistanceKm > 0
    ? Math.max(0, Math.min(100, Math.round(completedDistanceKm / routeDistanceKm * 100)))
    : distanceToDestinationKm <= 2 ? 100 : 0;

  return {
    progress,
    routeDistanceKm,
    completedDistanceKm,
    remainingDistanceKm: Math.max(0, routeDistanceKm - completedDistanceKm),
    distanceToDestinationKm,
  };
}

export function deriveDeliveryState(
  currentStatus: "In transit" | "Delayed" | "Loading" | "Delivered",
  metrics: RouteMetrics,
  speed: number,
  previousProgress = 0,
) {
  if (currentStatus === "Delivered" || metrics.distanceToDestinationKm <= 2) {
    return { status: "Delivered" as const, progress: 100 };
  }

  // A customer-facing trip should not appear to travel backwards because one GPS
  // fix projected slightly behind the previous one. We keep the highest confirmed
  // percentage while still using the newest position for distance and arrival.
  const progress = Math.max(previousProgress, metrics.progress);

  if (currentStatus === "Delayed") {
    return { status: currentStatus, progress };
  }
  if (progress >= 1 || speed > 3) {
    return { status: "In transit" as const, progress };
  }
  return { status: "Loading" as const, progress };
}
