import type { DeliveryRow, DeliveryScanCheckpoint, DeliveryScanSummary } from "./delivery-store.types";

export type PendingScanItem = {
  id: string;
  shortCode: string | null;
  customer: string;
  destination: string;
  truck: string;
};

export type PendingScanList = {
  checkpoint: DeliveryScanCheckpoint;
  groupByTruck: boolean;
  items: PendingScanItem[];
};

function toItem(delivery: DeliveryRow): PendingScanItem {
  return { id: delivery.id, shortCode: delivery.shortCode ?? null, customer: delivery.customer, destination: delivery.destination, truck: delivery.truck };
}

function sortByShortCode(a: PendingScanItem, b: PendingScanItem) {
  return (a.shortCode ?? a.id).localeCompare(b.shortCode ?? b.id);
}

function sortByTruckThenShortCode(a: PendingScanItem, b: PendingScanItem) {
  return a.truck.localeCompare(b.truck) || sortByShortCode(a, b);
}

// Scopes each checkpoint's "still needs scanning" list to what's actually
// outstanding at that specific step, not every open delivery -- live
// request: "I wanna have at least a list of the parcels they are supposed
// to still scan... not leaving out/forgetting parcels".
//
// `deliveries` must already be filtered to this company and exclude
// Delivered (callers already have this list for other reasons -- keeping
// that filter here too would mean re-deriving "not delivered" twice).
export function computePendingScanList(
  checkpoint: DeliveryScanCheckpoint,
  deliveries: DeliveryRow[],
  summaries: Map<string, DeliveryScanSummary>,
  agencySiteId: string | null,
): PendingScanList {
  if (checkpoint === "delivered") {
    // Same scoping as the checkpoint itself (scan/route.ts): an agency
    // only ever confirms its own destination's parcels, so its pending
    // list is naturally just that agency -- a dispatcher (agencySiteId
    // null) sees every still-open destination instead, matching its own
    // broader scan access.
    const scoped = agencySiteId ? deliveries.filter((delivery) => delivery.destinationSiteId === agencySiteId) : deliveries;
    return { checkpoint, groupByTruck: false, items: scoped.map(toItem).sort(sortByShortCode) };
  }

  // "loaded" and "arrived" (hub) are never site-scoped -- a hub scan in
  // particular has no fixed site to filter by (see scan/route.ts's own
  // comment on nearestGeocodedSiteLabel), and loading happens at the one
  // shared depot. Several trucks can be in either state at once, so the
  // list is grouped by truck client-side rather than requiring a filter.
  const scoped = checkpoint === "loaded"
    ? deliveries.filter((delivery) => delivery.status === "Loading" && !summaries.get(delivery.id)?.loadedAt)
    : deliveries.filter((delivery) => Boolean(summaries.get(delivery.id)?.loadedAt) && !summaries.get(delivery.id)?.hubArrivedAt);
  return { checkpoint, groupByTruck: true, items: scoped.map(toItem).sort(sortByTruckThenShortCode) };
}
