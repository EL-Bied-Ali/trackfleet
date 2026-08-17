import type { DeliveryRow } from "./delivery-store.types";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";
import { routeTemplateId } from "./route-template.ts";

export type PlannedTripCreationError = "delivery_not_unassigned" | "origin_required" | "destination_required" | "truck_required";

export function validateNewPlannedTrip(delivery: DeliveryRow, truck: string): PlannedTripCreationError | null {
  if (delivery.status === "Delivered" || delivery.tripId || !isUnassignedVehicle(delivery)) return "delivery_not_unassigned";
  if (!delivery.originSiteId) return "origin_required";
  if (!delivery.destinationSiteId) return "destination_required";
  if (!truck.trim()) return "truck_required";
  return null;
}

export function firstStopRouteTemplateId(delivery: Pick<DeliveryRow, "originSiteId" | "destinationSiteId">) {
  return routeTemplateId(delivery.originSiteId, delivery.destinationSiteId ? [delivery.destinationSiteId] : []);
}

export function manualTripVehicleKey(truck: string) {
  const normalized = truck.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `manual:${normalized || "truck"}`;
}
