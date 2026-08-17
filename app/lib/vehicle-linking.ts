import type { SendatrackVehicle } from "./sendatrack";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";

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
  if (isUnassignedVehicle(delivery)) return { vehicle: null, reason: "none", candidates: [] };
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

export function vehicleSearchIdentity(value: string) {
  return normalizeVehicleIdentity(value).replace(/\d+/g, (digits) => String(Number(digits)));
}

export function rankVehicleSuggestions<T extends Pick<SendatrackVehicle, "id" | "name">>(query: string, vehicles: T[]): T[] {
  const strict = normalizeVehicleIdentity(query);
  const tolerant = vehicleSearchIdentity(query);
  return [...vehicles]
    .map((vehicle) => {
      const vehicleStrict = normalizeVehicleIdentity(vehicle.name);
      const vehicleTolerant = vehicleSearchIdentity(vehicle.name);
      const score = !strict ? 3
        : vehicleStrict === strict ? 0
        : tolerant && vehicleTolerant === tolerant ? 1
        : vehicleStrict.includes(strict) || (tolerant && vehicleTolerant.includes(tolerant)) ? 2
        : 3;
      return { vehicle, score };
    })
    .filter((entry) => !strict || entry.score < 3)
    .sort((a, b) => a.score - b.score || a.vehicle.name.localeCompare(b.vehicle.name))
    .map((entry) => entry.vehicle);
}
