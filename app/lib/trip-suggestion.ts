import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";

export type SuggestionDelivery = {
  originSiteId?: string | null;
  destinationSiteId?: string | null;
  truck?: string | null;
  sendatrackVehicleId?: string | null;
};

export type SuggestionTrip = {
  id: string;
  routeTemplateId: string;
  truck: string;
  sendatrackVehicleId: string;
  originSiteId: string | null;
  status: "planned" | "active" | "completed";
  stops: Array<{ siteId: string; sequence: number; plannedArrivalAt: string | Date | null }>;
};

export type PlannedTripSuggestion = {
  tripId: string;
  routeTemplateId: string;
  truck: string;
  sendatrackVehicleId: string;
  stopSequence: number;
  plannedArrivalAt: string | Date | null;
};

function timeValue(value: string | Date | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function suggestPlannedTrip(delivery: SuggestionDelivery, trips: SuggestionTrip[]): PlannedTripSuggestion | null {
  if (!isUnassignedVehicle(delivery) || !delivery.destinationSiteId) return null;

  const candidates = trips.flatMap((trip) => {
    if (trip.status !== "planned") return [];
    if (delivery.originSiteId && trip.originSiteId && trip.originSiteId !== delivery.originSiteId) return [];
    if (delivery.originSiteId && !trip.originSiteId) return [];
    const stop = trip.stops.find((item) => item.siteId === delivery.destinationSiteId);
    if (!stop) return [];
    return [{ trip, stop }];
  });

  candidates.sort((a, b) =>
    timeValue(a.stop.plannedArrivalAt) - timeValue(b.stop.plannedArrivalAt)
    || a.stop.sequence - b.stop.sequence
    || a.trip.id.localeCompare(b.trip.id)
  );

  const best = candidates[0];
  if (!best) return null;
  return {
    tripId: best.trip.id,
    routeTemplateId: best.trip.routeTemplateId,
    truck: best.trip.truck,
    sendatrackVehicleId: best.trip.sendatrackVehicleId,
    stopSequence: best.stop.sequence,
    plannedArrivalAt: best.stop.plannedArrivalAt,
  };
}
