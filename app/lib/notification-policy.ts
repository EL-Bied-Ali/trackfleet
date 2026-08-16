export function parseAutomationStartAt(value: string | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isHistoricalNotification(eventCreatedAt: Date, automationStartAt: Date) {
  return eventCreatedAt.getTime() < automationStartAt.getTime();
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
