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
