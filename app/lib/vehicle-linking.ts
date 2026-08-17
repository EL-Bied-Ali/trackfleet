import type { SendatrackVehicle } from "./sendatrack";

export type VehicleLinkMatch = {
  vehicle: SendatrackVehicle | null;
  reason: "id" | "normalized_name" | "ambiguous" | "none";
  candidates: SendatrackVehicle[];
};

export function normalizeVehicleIdentity(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchDeliveryVehicle(
  delivery: { sendatrackVehicleId?: string | null; truck?: string | null },
  vehicles: SendatrackVehicle[],
): VehicleLinkMatch {
  const knownId = delivery.sendatrackVehicleId?.trim();
  if (knownId) {
    const exact = vehicles.find((vehicle) => vehicle.id === knownId) ?? null;
    return exact
      ? { vehicle: exact, reason: "id", candidates: [exact] }
      : { vehicle: null, reason: "none", candidates: [] };
  }

  const wanted = normalizeVehicleIdentity(delivery.truck ?? "");
  if (!wanted) return { vehicle: null, reason: "none", candidates: [] };

  const candidates = vehicles.filter((vehicle) => normalizeVehicleIdentity(vehicle.name) === wanted);
  if (candidates.length === 1) return { vehicle: candidates[0], reason: "normalized_name", candidates };
  if (candidates.length > 1) return { vehicle: null, reason: "ambiguous", candidates };
  return { vehicle: null, reason: "none", candidates: [] };
}
