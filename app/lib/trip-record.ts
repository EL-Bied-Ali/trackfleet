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
