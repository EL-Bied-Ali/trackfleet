export type TripStatus = "planned" | "active" | "completed";

export type TripStopSnapshot = {
  siteId: string;
  destination: string;
  sequence: number;
  plannedArrivalAt: Date | null;
};

export type TripRecord = {
  id: string;
  companyId: string;
  routeTemplateId: string;
  vehicleKey: string;
  truck: string;
  sendatrackVehicleId: string;
  originSiteId: string | null;
  stops: TripStopSnapshot[];
  status: TripStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertTripInput = Omit<TripRecord, "createdAt" | "updatedAt">;

export function tripStopsFromPlan(stops: Array<{ siteId: string; destination: string; plannedArrivalAt: Date | null }>): TripStopSnapshot[] {
  return stops.map((stop, index) => ({
    siteId: stop.siteId,
    destination: stop.destination,
    sequence: index + 1,
    plannedArrivalAt: stop.plannedArrivalAt,
  }));
}

export function tripStatusFromDeliveryStatuses(statuses: string[]): TripStatus {
  // A trip is only ever created (upsertTrip) from a plan that already has at
  // least one delivery, so an empty array here never means "brand new,
  // nothing assigned yet" -- it means every delivery that used to be on
  // this trip has since been reassigned elsewhere, i.e. the trip is
  // orphaned. Both call sites (fleet-business-tick.ts and
  // api/deliveries/route.ts) sweep persisted trips looking for exactly this
  // case, closing out anything that isn't already "completed" -- returning
  // "planned" here silently exempted every orphaned trip from that sweep
  // forever, since "planned" can never satisfy that check.
  if (statuses.length === 0) return "completed";
  if (statuses.every((status) => status === "Delivered")) return "completed";
  if (statuses.some((status) => status === "In transit" || status === "Delayed")) return "active";
  return "planned";
}
