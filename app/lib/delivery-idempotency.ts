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
  input: { customer: string; destination: string; contact: string; customerEmail?: string | null; recipientName?: string; recipientContact?: string; eta: string; plannedArrivalAt: Date | null; nextTruckDepartureAt?: Date | null; weightKg?: number | null; priceAmount?: number | null; priceCurrency?: string | null; itemDescription?: string | null },
) {
  const existingPlanned = delivery.plannedArrivalAt?.getTime() ?? null;
  const requestedPlanned = input.plannedArrivalAt?.getTime() ?? null;
  const existingDeparture = delivery.nextTruckDepartureAt?.getTime() ?? null;
  const requestedDeparture = input.nextTruckDepartureAt?.getTime() ?? null;
  return delivery.customer === input.customer
    && delivery.destination === input.destination
    && delivery.contact === input.contact
    && (delivery.customerEmail ?? null) === (input.customerEmail ?? null)
    && (delivery.recipientName ?? "") === (input.recipientName ?? "")
    && (delivery.recipientContact ?? "") === (input.recipientContact ?? "")
    && delivery.eta === input.eta
    && (delivery.weightKg ?? null) === (input.weightKg ?? null)
    && (delivery.priceAmount ?? null) === (input.priceAmount ?? null)
    && (delivery.priceCurrency ?? null) === (input.priceCurrency ?? null)
    && (delivery.itemDescription ?? null) === (input.itemDescription ?? null)
    && existingPlanned === requestedPlanned
    && existingDeparture === requestedDeparture;
}
