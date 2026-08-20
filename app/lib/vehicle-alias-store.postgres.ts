import { neon } from "@neondatabase/serverless";
import type { SetVehicleAliasInput, VehicleAlias, VehicleAliasStore } from "./vehicle-alias-store.types";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres vehicle alias store");
const sql = neon(databaseUrl);

const runtimeSchemaBootstrapEnabled = process.env.TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP === "true";
let schemaPromise: Promise<void> | null = null;

async function ensureSchema() {
  // Same explicit, opt-in bootstrap escape hatch used by the other Postgres
  // stores: production requests never spend a subrequest creating schema.
  if (!runtimeSchemaBootstrapEnabled) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS vehicle_aliases (
      company_id text NOT NULL,
      sendatrack_vehicle_id text NOT NULL,
      alias text NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (company_id, sendatrack_vehicle_id)
    )`;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function hydrate(row: Record<string, unknown>): VehicleAlias {
  return {
    companyId: String(row.company_id),
    sendatrackVehicleId: String(row.sendatrack_vehicle_id),
    alias: String(row.alias),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export const postgresVehicleAliasStore: VehicleAliasStore = {
  async listForCompany(companyId) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM vehicle_aliases WHERE company_id = ${companyId}`;
    return rows.map((row) => hydrate(row as Record<string, unknown>));
  },
  async set(input: SetVehicleAliasInput) {
    await ensureSchema();
    const rows = await sql`INSERT INTO vehicle_aliases (company_id, sendatrack_vehicle_id, alias, updated_at)
      VALUES (${input.companyId}, ${input.sendatrackVehicleId}, ${input.alias}, now())
      ON CONFLICT (company_id, sendatrack_vehicle_id) DO UPDATE SET alias = excluded.alias, updated_at = now()
      RETURNING *`;
    return hydrate(rows[0] as Record<string, unknown>);
  },
};
