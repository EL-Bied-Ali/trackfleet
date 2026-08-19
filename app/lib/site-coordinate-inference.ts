import { haversineKm } from "./fleet-trip-reconstruction";
import { normalizePhysicalVehicleName } from "./vehicle-identity";

export type SiteCoordinateInferenceSite = {
  id: string;
  label: string;
  city: string;
  address: string;
  country: string;
};

export type SiteCoordinateInferencePoint = {
  vehicleName: string;
  latitude: number;
  longitude: number;
  speed: number;
  address: string;
  positionAt: Date;
};

export type SiteCoordinateSuggestion = {
  siteId: string;
  latitude: number | null;
  longitude: number | null;
  confidence: "high" | "medium" | "low";
  pointCount: number;
  vehicleCount: number;
  addressEvidence: string[];
  radius95Km: number | null;
};

const genericAddressTokens = new Set([
  "avenue", "boulevard", "route", "rue", "street", "road", "lot", "residence", "maroc", "morocco",
  "belgique", "belgium", "ville", "port", "centre", "center", "quartier", "hay", "derb", "douar",
]);

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return normalized(value).split(/\s+/).filter((token) => token.length >= 4 && !genericAddressTokens.has(token));
}

function rounded(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function clusterKey(point: SiteCoordinateInferencePoint) {
  // ~100 m cells in the Morocco/Belgium corridor. This is intentionally much
  // smaller than TrackFleet's default 500 m arrival geofence.
  return `${point.latitude.toFixed(3)}:${point.longitude.toFixed(3)}`;
}

function addressEvidence(site: SiteCoordinateInferenceSite, points: SiteCoordinateInferencePoint[]) {
  const city = normalized(site.city);
  const distinctive = new Set(tokens(`${site.label} ${site.address}`).filter((token) => !city.includes(token)));
  const pointText = normalized(points.map((point) => point.address).join(" "));
  const matches = [...distinctive].filter((token) => pointText.includes(token));
  const cityMatch = city.length >= 4 && pointText.includes(city);
  return { matches, cityMatch };
}

function scoreCluster(site: SiteCoordinateInferenceSite, points: SiteCoordinateInferencePoint[]) {
  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const vehicles = new Set(points.map((point) => normalizePhysicalVehicleName(point.vehicleName)).filter(Boolean));
  const evidence = addressEvidence(site, points);
  const radius95Km = percentile95(points.map((point) => haversineKm(
    { latitude, longitude },
    { latitude: point.latitude, longitude: point.longitude },
  )));
  const repeated = points.length >= 8 && vehicles.size >= 2;
  const compact = radius95Km <= 0.35;
  const confidence: SiteCoordinateSuggestion["confidence"] = repeated && compact && evidence.matches.length > 0
    ? "high"
    : repeated && compact && evidence.cityMatch
      ? "medium"
      : "low";
  return {
    siteId: site.id,
    latitude: rounded(latitude),
    longitude: rounded(longitude),
    confidence,
    pointCount: points.length,
    vehicleCount: vehicles.size,
    addressEvidence: evidence.matches,
    radius95Km: rounded(radius95Km, 3),
    relevant: evidence.matches.length > 0 || evidence.cityMatch,
  };
}

function emptySuggestion(siteId: string): SiteCoordinateSuggestion {
  return {
    siteId,
    latitude: null,
    longitude: null,
    confidence: "low",
    pointCount: 0,
    vehicleCount: 0,
    addressEvidence: [],
    radius95Km: null,
  };
}

export function inferSiteCoordinateSuggestions(
  sites: SiteCoordinateInferenceSite[],
  observations: SiteCoordinateInferencePoint[],
): SiteCoordinateSuggestion[] {
  const stationary = observations.filter((point) =>
    Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && Math.abs(point.latitude) <= 90
      && Math.abs(point.longitude) <= 180
      && Number.isFinite(point.speed)
      && point.speed <= 5,
  );
  const clusters = new Map<string, SiteCoordinateInferencePoint[]>();
  for (const point of stationary) {
    const key = clusterKey(point);
    const existing = clusters.get(key) ?? [];
    existing.push(point);
    clusters.set(key, existing);
  }

  return sites.map((site) => {
    const scored = [...clusters.values()]
      .map((cluster) => scoreCluster(site, cluster))
      .filter((candidate) => candidate.relevant)
      .sort((left, right) => {
        const rank = { high: 3, medium: 2, low: 1 } as const;
        if (rank[right.confidence] !== rank[left.confidence]) return rank[right.confidence] - rank[left.confidence];
        if (right.addressEvidence.length !== left.addressEvidence.length) return right.addressEvidence.length - left.addressEvidence.length;
        if (right.vehicleCount !== left.vehicleCount) return right.vehicleCount - left.vehicleCount;
        return right.pointCount - left.pointCount;
      });
    const best = scored[0];
    if (!best) return emptySuggestion(site.id);
    const { relevant: _relevant, ...suggestion } = best;
    return suggestion;
  });
}
