import type { SetVehicleAliasInput, VehicleAlias, VehicleAliasStore } from "./vehicle-alias-store.types.ts";

const rows = new Map<string, VehicleAlias>();

export const memoryVehicleAliasStore: VehicleAliasStore = {
  async listForCompany(companyId) {
    return [...rows.values()].filter((row) => row.companyId === companyId);
  },
  async set(input: SetVehicleAliasInput) {
    const key = `${input.companyId}:${input.sendatrackVehicleId}`;
    const row: VehicleAlias = { ...input, updatedAt: new Date() };
    rows.set(key, row);
    return row;
  },
};
