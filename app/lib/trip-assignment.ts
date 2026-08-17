import type { DeliveryRow } from "./delivery-store.types";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record";

export type TripAssignmentError = "delivery_not_unassigned" | "trip_not_planned" | "origin_mismatch" | "destination_not_on_trip";

export function validatePlannedTripAssignment(delivery: DeliveryRow, trip: TripRecord): TripAssignmentError | null {
  if (delivery.tripId || !isUnassignedVehicle(delivery)) return "delivery_not_unassigned";
  if (trip.status !== "planned") return "trip_not_planned";
  if (delivery.originSiteId && trip.originSiteId !== delivery.originSiteId) return "origin_mismatch";
  if (!delivery.destinationSiteId || !trip.stops.some((stop) => stop.siteId === delivery.destinationSiteId)) return "destination_not_on_trip";
  return null;
}
