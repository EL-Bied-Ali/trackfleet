import type { DeliveryEventType } from "./delivery-events";

export function parseAutomationStartAt(value: string | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isHistoricalNotification(eventCreatedAt: Date, automationStartAt: Date) {
  return eventCreatedAt.getTime() < automationStartAt.getTime();
}

// Deliberately just the two events with real customer behavior attached:
// REGISTERED carries the tracking link (everything else lives on that page
// instead of a separate push), and ARRIVED_AT_SITE is the actionable "come
// get it" nudge. DEPARTED/NEAR_DESTINATION/DELAY_DETECTED are FYI-only status
// changes -- cutting them as pushes (customer still sees them on the tracking
// page) roughly halves message volume without losing either message that
// actually drives customer action.
const automaticWhatsAppEvents = new Set<DeliveryEventType>([
  "REGISTERED",
  "ARRIVED_AT_SITE",
]);

export function isAutomaticWhatsAppEvent(event: DeliveryEventType) {
  return automaticWhatsAppEvents.has(event);
}

type PendingLike = {
  delivery: { id: string };
  event: { createdAt: Date };
};

export function splitLatestPendingNotifications<T extends PendingLike>(items: T[]) {
  const latestByDelivery = new Map<string, T>();
  for (const item of items) {
    const current = latestByDelivery.get(item.delivery.id);
    if (!current || item.event.createdAt.getTime() >= current.event.createdAt.getTime()) {
      latestByDelivery.set(item.delivery.id, item);
    }
  }

  const latest = new Set(latestByDelivery.values());
  return {
    actionable: items.filter((item) => latest.has(item)),
    superseded: items.filter((item) => !latest.has(item)),
  };
}

type ShipmentPendingLike = PendingLike & {
  delivery: { id: string; shipmentId?: string | null };
  event: { type: string };
};

// A "weigh together" shipment (see the parcel-grouping checkbox in the
// creation form) is N separate delivery rows sharing one shipmentId, each
// carrying its own copy of REGISTERED/ARRIVED_AT_SITE. Left ungrouped, a
// customer with 3 parcels on one truck would get 3 near-identical WhatsApp
// pushes for the same real-world event. One representative per
// (shipmentId, event type) group is actually sent, and its siblings ride
// along on WHATEVER the representative's real outcome turns out to be
// (see resolveShipmentSiblings in notification-runner.ts) -- deliberately
// NOT pre-resolved here, since the caller doesn't yet know whether the
// representative will send, get permanently suppressed (no consent, no
// tracking token), or fail and need a retry. Marking siblings "sent" before
// that's known would silently lose their notification forever the moment
// the representative's send didn't actually go out. The group's size
// travels back so a successful send can say "3 colis liés à cet envoi"
// instead of silently dropping the other parcels from the customer's view.
export function groupActionableByShipment<T extends ShipmentPendingLike>(actionable: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of actionable) {
    const key = `${item.delivery.shipmentId ?? item.delivery.id}:${item.event.type}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.values()).map((group) => {
    const [item, ...siblings] = group;
    return { item, parcelCount: group.length, siblings };
  });
}
