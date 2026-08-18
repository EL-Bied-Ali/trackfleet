import type { DeliveryRow } from "./delivery-store.types";

const privateDeliveryFields = new Set([
  "companyId",
  "contact",
  "trackingToken",
  "whatsappOptIn",
  "whatsappOptInAt",
]);

/**
 * Public tracking is deliberately a projection, not a serialized DeliveryRow.
 * Keeping the privacy boundary here makes it easy to audit which sensitive
 * parcel fields are never exposed through a public tracking URL.
 */
export function publicDeliveryView<T extends DeliveryRow>(delivery: T) {
  return Object.fromEntries(
    Object.entries(delivery).filter(([key]) => !privateDeliveryFields.has(key)),
  );
}
