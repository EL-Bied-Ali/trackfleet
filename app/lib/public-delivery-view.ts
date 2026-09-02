import type { DeliveryRow } from "./delivery-store.types";

type PublicDeliverySource = DeliveryRow & {
  routeDistanceKm?: number | null;
  remainingDistanceKm?: number | null;
  distanceToDestinationKm?: number | null;
  positionAgeMinutes?: number | null;
  gpsFresh?: boolean;
  estimatedArrivalAt?: string | null;
  etaDelayMinutes?: number | null;
  etaConfidence?: "none" | "low" | "medium";
  etaSource?: "unavailable" | "baseline-model" | "route-history" | "observed-pace";
  effectiveSpeedKmh?: number | null;
  pendingStopServiceMinutes?: number;
  etaHistoryTrips?: number;
  etaHistoricalSpeedKmh?: number | null;
  trackingExpiresAt?: string | null;
  manualArrivalEstimateHours?: number | null;
  manualArrivalEstimateSampleCount?: number;
};

/**
 * A public tracking URL receives only fields needed to render the customer
 * experience. Operational/tenant/customer-contact fields are omitted by
 * construction instead of relying on a deny-list.
 */
export function publicDeliveryView(delivery: PublicDeliverySource, options: { destinationWhatsapp?: string | null } = {}) {
  return {
    id: delivery.id,
    customer: delivery.customer,
    destination: delivery.destination,
    // Only the catalog id (e.g. "marrakech-essaouira-12"), not more
    // sensitive than the free-text destination address already exposed
    // above. Needed client-side to resolve KnownSite.finalLegTrackingUnavailable
    // so the tracking page can show an explicit "not GPS-tracked" note
    // instead of implying live coverage that doesn't exist.
    destinationSiteId: delivery.destinationSiteId ?? null,
    // Deliberately caller-supplied, not read off `delivery` -- the caller is
    // responsible for only passing a value once the parcel has genuinely
    // reached this destination (status === "Delivered"), never earlier, so a
    // customer only sees a number to call once there's actually someone to
    // call at the other end.
    destinationWhatsapp: options.destinationWhatsapp ?? null,
    weightKg: delivery.weightKg ?? null,
    priceAmount: delivery.priceAmount ?? null,
    priceCurrency: delivery.priceCurrency ?? null,
    itemDescription: delivery.itemDescription ?? null,
    destinationLatitude: delivery.destinationLatitude,
    destinationLongitude: delivery.destinationLongitude,
    arrivalRadiusKm: delivery.arrivalRadiusKm,
    truck: delivery.truck,
    status: delivery.status,
    eta: delivery.eta,
    plannedArrivalAt: delivery.plannedArrivalAt,
    progress: delivery.progress,
    latitude: delivery.latitude,
    longitude: delivery.longitude,
    speed: delivery.speed,
    lastPositionAt: delivery.lastPositionAt,
    routeDistanceKm: delivery.routeDistanceKm ?? null,
    remainingDistanceKm: delivery.remainingDistanceKm ?? null,
    distanceToDestinationKm: delivery.distanceToDestinationKm ?? null,
    positionAgeMinutes: delivery.positionAgeMinutes ?? null,
    gpsFresh: delivery.gpsFresh ?? false,
    estimatedArrivalAt: delivery.estimatedArrivalAt ?? null,
    etaDelayMinutes: delivery.etaDelayMinutes ?? null,
    etaConfidence: delivery.etaConfidence ?? "none",
    etaSource: delivery.etaSource ?? "unavailable",
    effectiveSpeedKmh: delivery.effectiveSpeedKmh ?? null,
    etaHistoryTrips: delivery.etaHistoryTrips ?? 0,
    etaHistoricalSpeedKmh: delivery.etaHistoricalSpeedKmh ?? null,
    trackingExpiresAt: delivery.trackingExpiresAt ?? null,
    manualArrivalEstimateHours: delivery.manualArrivalEstimateHours ?? null,
    manualArrivalEstimateSampleCount: delivery.manualArrivalEstimateSampleCount ?? 0,
  };
}
