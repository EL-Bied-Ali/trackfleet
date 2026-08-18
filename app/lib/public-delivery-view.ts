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
 * Keeping the allow/deny boundary here prevents newly added operational fields
 * from accidentally exposing customer or tenant metadata in a tracking link.
 */
export function publicDeliveryView<T extends DeliveryRow & Record<string, unknown>>(delivery: T) {
  return Object.fromEntries(
    Object.entries(delivery).filter(([key]) => !privateDeliveryFields.has(key)),
  );
}
