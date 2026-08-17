import type { DeliveryRow } from "./delivery-store.types";

function cleanPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

export function routeSignature(originSiteId: string | null | undefined, orderedDestinationSiteIds: string[]) {
  const origin = cleanPart(originSiteId ?? "unknown-origin") || "unknown-origin";
  const destinations = orderedDestinationSiteIds.map(cleanPart).filter(Boolean);
  return [origin, ...destinations].join(">");
}

export function routeTemplateId(originSiteId: string | null | undefined, orderedDestinationSiteIds: string[]) {
  return `ROUTE-${hashString(routeSignature(originSiteId, orderedDestinationSiteIds))}`;
}

export function routeOriginSiteId(deliveries: DeliveryRow[]) {
  const ids = [...new Set(deliveries.map((delivery) => delivery.originSiteId).filter((value): value is string => Boolean(value)))];
  return ids.length === 1 ? ids[0] : null;
}
