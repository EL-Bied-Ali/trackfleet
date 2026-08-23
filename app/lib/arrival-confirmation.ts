import type { DeliveryEventType } from "./delivery-events";

export type ArrivalConfirmationState =
  | "automatic_pending"
  | "manual_recommended"
  | "automatic_confirmed"
  | "manual_confirmed";

export type ArrivalConfirmationReason =
  | "in_transit"
  | "destination_coordinates_missing"
  | "gps_unavailable"
  | "gps_stale"
  | "gps_arrival_detected"
  | "manual_already_confirmed"
  | "ctm_relay_in_progress";

type ArrivalConfirmationInput = {
  status: string;
  progress: number;
  plannedArrivalAt: Date | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  gpsSource: string;
  latitude: number | null;
  longitude: number | null;
  lastPositionAt: Date | null;
  events: Array<{ type: DeliveryEventType }>;
  // True when the destination is only reached via a local/relay leg our
  // GPS-tracked trucks never physically visit (see KnownSite.finalLegTrackingUnavailable).
  // GPS going stale or missing destination coordinates is the *expected*,
  // permanent state for this leg -- not a problem needing a dispatcher's
  // attention -- because fleet-business-tick.ts already runs a dedicated
  // ~24h relay completion timer for it. Without this flag, this function
  // recommended (and prominently highlighted) manual confirmation the
  // moment GPS naturally went stale right after leaving the tracked hub --
  // a dispatcher clicking it would fire the standard ~2h grace instead of
  // the correct ~24h relay window, sending the customer a premature
  // "arrived" WhatsApp message while the parcel was still genuinely in
  // transit via the relay carrier.
  finalLegTrackingUnavailable?: boolean;
  now?: Date;
};

export function arrivalConfirmationRecommendation(input: ArrivalConfirmationInput): {
  state: ArrivalConfirmationState;
  reason: ArrivalConfirmationReason;
} {
  if (input.events.some((event) => event.type === "MANUAL_ARRIVAL_CONFIRMED")) {
    return { state: "manual_confirmed", reason: "manual_already_confirmed" };
  }
  if (input.events.some((event) => event.type === "ARRIVED_AT_SITE")) {
    return { state: "automatic_confirmed", reason: "gps_arrival_detected" };
  }

  const now = input.now ?? new Date();
  const arrivalPlausible = input.status !== "Loading"
    && (input.progress >= 90 || Boolean(input.plannedArrivalAt && input.plannedArrivalAt.getTime() <= now.getTime()));
  if (!arrivalPlausible) return { state: "automatic_pending", reason: "in_transit" };

  if (input.finalLegTrackingUnavailable) {
    return { state: "automatic_pending", reason: "ctm_relay_in_progress" };
  }

  if (typeof input.destinationLatitude !== "number" || typeof input.destinationLongitude !== "number") {
    return { state: "manual_recommended", reason: "destination_coordinates_missing" };
  }
  if (
    input.gpsSource !== "sendatrack"
    || typeof input.latitude !== "number"
    || typeof input.longitude !== "number"
    || !input.lastPositionAt
  ) {
    return { state: "manual_recommended", reason: "gps_unavailable" };
  }
  if (now.getTime() - input.lastPositionAt.getTime() > 30 * 60_000) {
    return { state: "manual_recommended", reason: "gps_stale" };
  }
  return { state: "automatic_pending", reason: "in_transit" };
}
