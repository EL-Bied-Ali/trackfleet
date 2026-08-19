import type { DeliveryRow } from "./delivery-store.types";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function validDeliveryIdempotencyKey(value: string) {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function deliveryIdempotencyTrackingToken(companyId: string, key: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`trackfleet-delivery-idempotency:${companyId}:${key}`),
  ));
  return toBase64Url(digest.slice(0, 18));
}

export function deliveryIdempotencyPayloadMatches(
  delivery: DeliveryRow,
  input: { customer: string; destination: string; contact: string; plannedArrivalAt: Date | null },
) {
  const existingPlanned = delivery.plannedArrivalAt?.getTime() ?? null;
  const requestedPlanned = input.plannedArrivalAt?.getTime() ?? null;
  return delivery.customer === input.customer
    && delivery.destination === input.destination
    && delivery.contact === input.contact
    && existingPlanned === requestedPlanned;
}
