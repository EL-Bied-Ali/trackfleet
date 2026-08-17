export type CreationVehicleOption = { id: string; name: string };

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
  const liveVehicle = input.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  return {
    truck: liveVehicle?.name ?? selectedVehicleId,
    sendatrackVehicleId: liveVehicle?.id ?? "",
    source: liveVehicle ? "sendatrack" as const : "manual" as const,
  };
}
