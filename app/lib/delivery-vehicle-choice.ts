export type CreationVehicleOption = { id: string; name: string };

export const UNASSIGNED_TRUCK = "__unassigned__";
export const UNASSIGNED_VEHICLE_ID = "__unassigned__";

export function isUnassignedVehicle(delivery: { truck?: string | null; sendatrackVehicleId?: string | null }) {
  return !String(delivery.sendatrackVehicleId ?? "").trim() && String(delivery.truck ?? "").trim() === UNASSIGNED_TRUCK;
}

export function resolveCreationVehicle(input: {
  manualTruck?: string | null;
  selectedVehicleId?: string | null;
  vehicles: CreationVehicleOption[];
}) {
  const manualTruck = String(input.manualTruck ?? "").trim();
  if (manualTruck) {
    return {
      truck: manualTruck,
      sendatrackVehicleId: "",
      source: "manual" as const,
    };
  }

  const selectedVehicleId = String(input.selectedVehicleId ?? "").trim();
  if (!selectedVehicleId || selectedVehicleId === UNASSIGNED_VEHICLE_ID) {
    return {
      truck: UNASSIGNED_TRUCK,
      sendatrackVehicleId: "",
      source: "unassigned" as const,
    };
  }

  const liveVehicle = input.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  return {
    truck: liveVehicle?.name ?? selectedVehicleId,
    sendatrackVehicleId: liveVehicle?.id ?? "",
    source: liveVehicle ? "sendatrack" as const : "manual" as const,
  };
}
