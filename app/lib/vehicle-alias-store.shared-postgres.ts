import "./postgres-runtime-bootstrap";
import { runtimeEnv } from "trackfleet-runtime-env";
import { vehicleAliasStore as primaryVehicleAliasStore } from "./vehicle-alias-store.vercel";
import type { SetVehicleAliasInput, VehicleAlias, VehicleAliasStore } from "./vehicle-alias-store.types";

type D1MirrorStatement = {
  bind(...values: unknown[]): D1MirrorStatement;
  run(): Promise<unknown>;
};

type D1MirrorBinding = {
  prepare(query: string): D1MirrorStatement;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1MirrorBinding }).DB ?? null;
}

async function mirrorAlias(alias: VehicleAlias) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare(`INSERT INTO vehicle_aliases (company_id, sendatrack_vehicle_id, alias, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, sendatrack_vehicle_id) DO UPDATE SET
        alias = excluded.alias,
        updated_at = excluded.updated_at`)
      .bind(alias.companyId, alias.sendatrackVehicleId, alias.alias, alias.updatedAt.getTime())
      .run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 vehicle alias mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
      companyId: alias.companyId,
      sendatrackVehicleId: alias.sendatrackVehicleId,
    });
  }
}

export const vehicleAliasStore: VehicleAliasStore = {
  listForCompany(companyId: string) {
    return primaryVehicleAliasStore.listForCompany(companyId);
  },
  async set(input: SetVehicleAliasInput) {
    const alias = await primaryVehicleAliasStore.set(input);
    await mirrorAlias(alias);
    return alias;
  },
};
