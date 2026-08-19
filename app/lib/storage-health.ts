import { runtimeEnv } from "trackfleet-runtime-env";
import {
  REQUIRED_POSTGRES_COLUMNS,
  REQUIRED_POSTGRES_TABLES,
  normalizePostgresSchemaProbe,
  type PostgresSchemaProbe,
} from "./storage-schema-contract";

export type StorageHealth = {
  mode: "postgres" | "cloudflare-d1" | "memory";
  persistent: boolean;
  connected: boolean;
  error: string | null;
};

type D1HealthBinding = {
  prepare(query: string): {
    first<T = unknown>(): Promise<T | null>;
  };
};

function optionalD1Binding() {
  // The runtime-env alias intentionally has a different static DB type on
  // Vercel (unavailable) and Cloudflare (D1Database). Keep this cross-runtime
  // health probe structurally typed instead of making the Vercel build import
  // Cloudflare-specific globals.
  return (runtimeEnv as unknown as { DB?: D1HealthBinding }).DB;
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const databaseUrl = runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    try {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(databaseUrl);
      const requiredTables = JSON.stringify(REQUIRED_POSTGRES_TABLES);
      const requiredColumns = JSON.stringify(REQUIRED_POSTGRES_COLUMNS);
      const rows = await sql`
        WITH required_tables AS (
          SELECT value AS table_name
          FROM jsonb_array_elements_text(${requiredTables}::jsonb)
        ),
        required_columns AS (
          SELECT item->>'table' AS table_name, item->>'column' AS column_name
          FROM jsonb_array_elements(${requiredColumns}::jsonb) item
        ),
        missing_tables AS (
          SELECT required.table_name
          FROM required_tables required
          WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.tables actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = required.table_name
          )
        ),
        missing_columns AS (
          SELECT required.table_name, required.column_name
          FROM required_columns required
          WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns actual
            WHERE actual.table_schema = 'public'
              AND actual.table_name = required.table_name
              AND actual.column_name = required.column_name
          )
        )
        SELECT
          NOT EXISTS (SELECT 1 FROM missing_tables)
            AND NOT EXISTS (SELECT 1 FROM missing_columns) AS compatible,
          COALESCE((SELECT json_agg(table_name ORDER BY table_name) FROM missing_tables), '[]'::json) AS missing_tables,
          COALESCE((SELECT json_agg(table_name || '.' || column_name ORDER BY table_name, column_name) FROM missing_columns), '[]'::json) AS missing_columns
      ` as PostgresSchemaProbe[];
      const schema = normalizePostgresSchemaProbe(rows[0]);
      if (!schema.compatible) {
        console.error("[trackfleet:storage] postgres schema incompatible", {
          missingTables: schema.missingTables,
          missingColumns: schema.missingColumns,
        });
        return {
          mode: "postgres",
          persistent: true,
          connected: false,
          error: "postgres_schema_incompatible",
        };
      }
      return { mode: "postgres", persistent: true, connected: true, error: null };
    } catch (error) {
      console.error("[trackfleet:storage] postgres health check failed", {
        message: error instanceof Error ? error.message : "Postgres unavailable",
      });
      return {
        mode: "postgres",
        persistent: true,
        connected: false,
        error: "postgres_unavailable",
      };
    }
  }

  const db = optionalD1Binding();
  if (db) {
    try {
      await db.prepare("SELECT 1 AS ok").first();
      return { mode: "cloudflare-d1", persistent: true, connected: true, error: null };
    } catch (error) {
      console.error("[trackfleet:storage] D1 health check failed", {
        message: error instanceof Error ? error.message : "D1 unavailable",
      });
      return {
        mode: "cloudflare-d1",
        persistent: true,
        connected: false,
        error: "d1_unavailable",
      };
    }
  }

  return { mode: "memory", persistent: false, connected: true, error: null };
}
