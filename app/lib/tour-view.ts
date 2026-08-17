export type TourStopLike = {
  siteId: string;
  destination: string;
  plannedArrivalAt: Date | string | null;
  deliveryIds: string[];
  customers: string[];
};

export type TourPlanLike = {
  vehicleKey: string;
  truck: string;
  sendatrackVehicleId: string;
  tripId?: string | null;
  tripInstanceId?: string | null;
  stops: TourStopLike[];
};

function compactIdentity(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-8) || "UNASSIGNED";
}

export function activeTourDisplayId(plan: Pick<TourPlanLike, "vehicleKey" | "tripId" | "tripInstanceId">) {
  if (plan.tripId?.trim()) return plan.tripId;
  if (plan.tripInstanceId?.trim()) return plan.tripInstanceId;
  return `TOUR-${compactIdentity(plan.vehicleKey)}`;
}

export function activeTourKey(plan: Pick<TourPlanLike, "vehicleKey" | "tripId" | "tripInstanceId">) {
  return plan.tripId?.trim() || plan.tripInstanceId?.trim() || plan.vehicleKey;
}

export function tourDeliveryCount(plan: Pick<TourPlanLike, "stops">) {
  return plan.stops.reduce((total, stop) => total + stop.deliveryIds.length, 0);
}

export function tourCustomerCount(plan: Pick<TourPlanLike, "stops">) {
  return new Set(plan.stops.flatMap((stop) => stop.customers)).size;
}

export function stopSequence(plan: Pick<TourPlanLike, "stops">) {
  return plan.stops.map((stop, index) => ({ ...stop, sequence: index + 1 }));
}
