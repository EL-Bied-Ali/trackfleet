import type { DeliveryEventRow, DeliveryRow } from "./delivery-store.types";
import type { SiteRecord } from "./site-store.types";
import type { TripRecord } from "./trip-record";

export type TenantDataExport = {
  version: 1;
  generatedAt: string;
  companyId: string;
  deliveries: Array<Omit<DeliveryRow, "trackingToken">>;
  events: DeliveryEventRow[];
  trips: TripRecord[];
  sites: SiteRecord[];
};

export function sanitizeDeliveryForExport(delivery: DeliveryRow): Omit<DeliveryRow, "trackingToken"> {
  const { trackingToken: _trackingToken, ...safe } = delivery;
  return safe;
}

export function buildTenantDataExport(input: {
  companyId: string;
  deliveries: DeliveryRow[];
  events: DeliveryEventRow[];
  trips: TripRecord[];
  sites: SiteRecord[];
  generatedAt?: Date;
}): TenantDataExport {
  return {
    version: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    companyId: input.companyId,
    deliveries: input.deliveries.map(sanitizeDeliveryForExport),
    events: input.events,
    trips: input.trips,
    sites: input.sites,
  };
}
