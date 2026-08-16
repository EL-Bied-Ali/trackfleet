export type RouteMetrics = {
  progress: number;
  routeDistanceKm: number;
  completedDistanceKm: number;
  remainingDistanceKm: number;
  distanceToDestinationKm: number;
};

// Shared Belgium ↔ Morocco corridor used by the map. Coordinates are [longitude, latitude].
export const belgiumMoroccoCorridor: Array<[number, number]> = [
  [4.3517, 50.8503],
  [2.3522, 48.8566],
  [-0.5792, 44.8378],
  [-3.7038, 40.4168],
  [-5.453, 36.1408],
  [-5.8128, 35.7673],
  [-6.8498, 33.9716],
  [-7.5898, 33.5731],
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

function routeForDestination(destination: string) {
  return destination.trim().toUpperCase().endsWith(", BE")
    ? [...belgiumMoroccoCorridor].reverse()
    : belgiumMoroccoCorridor;
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
    : 0;

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
) {
  if (currentStatus === "Delivered" || metrics.distanceToDestinationKm <= 2) {
    return { status: "Delivered" as const, progress: 100 };
  }
  if (currentStatus === "Delayed") {
    return { status: currentStatus, progress: metrics.progress };
  }
  if (metrics.progress >= 1 || speed > 3) {
    return { status: "In transit" as const, progress: metrics.progress };
  }
  return { status: "Loading" as const, progress: metrics.progress };
}
