import { runtimeEnv } from "trackfleet-runtime-env";
import type { SetVehicleAliasInput, VehicleAlias, VehicleAliasStore } from "./vehicle-alias-store.types";

function db() {
  if (!runtimeEnv.DB) throw new Error("D1 database binding is missing");
  return runtimeEnv.DB;
}

function hydrate(row: Record<string, unknown>): VehicleAlias {
  return {
    companyId: String(row.company_id),
    sendatrackVehicleId: String(row.sendatrack_vehicle_id),
    alias: String(row.alias),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

export const vehicleAliasStore: VehicleAliasStore = {
  async listForCompany(companyId) {
    const result = await db().prepare("SELECT * FROM vehicle_aliases WHERE company_id=?").bind(companyId).all();
    return (result.results ?? []).map((row) => hydrate(row as Record<string, unknown>));
  },
  async set(input: SetVehicleAliasInput) {
    const now = Date.now();
    await db().prepare(`INSERT INTO vehicle_aliases (company_id,sendatrack_vehicle_id,alias,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(company_id,sendatrack_vehicle_id) DO UPDATE SET alias=excluded.alias,updated_at=excluded.updated_at`)
      .bind(input.companyId, input.sendatrackVehicleId, input.alias, now).run();
    const row = await db().prepare("SELECT * FROM vehicle_aliases WHERE company_id=? AND sendatrack_vehicle_id=?")
      .bind(input.companyId, input.sendatrackVehicleId).first();
    if (!row) throw new Error("vehicle_alias_write_failed");
    return hydrate(row as Record<string, unknown>);
  },
};
