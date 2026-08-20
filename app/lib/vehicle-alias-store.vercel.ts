import { memoryVehicleAliasStore } from "./vehicle-alias-store.memory";
import type { VehicleAliasStore } from "./vehicle-alias-store.types";

export const vehicleAliasStore: VehicleAliasStore = process.env.DATABASE_URL?.trim()
  ? (await import("./vehicle-alias-store.postgres")).postgresVehicleAliasStore
  : memoryVehicleAliasStore;
