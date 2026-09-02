import { getSqlOrNull } from "./pg-client.ts";
import { runtimeEnv } from "trackfleet-runtime-env";
import {
  REQUIRED_POSTGRES_COLUMNS,
  REQUIRED_POSTGRES_TABLES,
  normalizePostgresSchemaProbe,
  type PostgresSchemaProbe,
} from "./storage-schema-contract";
import { d1ReadFailoverConfigured } from "./d1-read-failover";
import {
  getD1StandbyReadiness,
  type D1StandbyReadiness,
  type D1ReadinessBinding,
} from "./d1-standby-readiness";

export type StorageFailoverHealth = {
  candidate: "cloudflare-d1" | null;
  available: boolean;
  connected: boolean | null;
  ready: boolean;
  automatic: boolean;
  reason:
    | "d1_not_bound"
    | "d1_unavailable"
    | "replication_not_started"
    | "replication_stale"
    | "history_backfill_incomplete"
    | "replication_ready"
    | "primary_is_d1_or_memory";
  readiness: D1StandbyReadiness | null;
  error: string | null;
};

export type StorageHealth = {
  mode: "postgres" | "cloudflare-d1" | "memory";
  persistent: boolean;
  connected: boolean;
  error: string | null;
  failover: StorageFailoverHealth;
};

type D1HealthBinding = D1ReadinessBinding & {
  prepare(query: string): {
    first<T = unknown>(): Promise<T | null>;
  };
};

function optionalD1Binding() {
  return (runtimeEnv as unknown as { DB?: D1HealthBinding }).DB;
}

function inactiveFailover(): StorageFailoverHealth {
  return {
    candidate: null,
    available: false,
    connected: null,
    ready: false,
    automatic: false,
    reason: "primary_is_d1_or_memory",
    readiness: null,
    error: null,
  };
}

async function probeD1Standby(): Promise<StorageFailoverHealth> {
  const automatic = d1ReadFailoverConfigured();
  const db = optionalD1Binding();
  if (!db) {
    return {
      candidate: null,
      available: false,
      connected: null,
      ready: false,
      automatic,
      reason: "d1_not_bound",
      readiness: null,
      error: null,
    };
  }
  try {
    const readiness = await getD1StandbyReadiness(db);
    return {
      candidate: "cloudflare-d1",
      available: true,
      connected: true,
      ready: readiness.ready,
      automatic,
      reason: readiness.reason === "ready" ? "replication_ready" : readiness.reason,
      readiness,
      error: null,
    };
  } catch (error) {
    console.error("[trackfleet:storage] D1 standby health check failed", {
      message: error instanceof Error ? error.message : "D1 unavailable",
    });
    return {
      candidate: "cloudflare-d1",
      available: true,
      connected: false,
      ready: false,
      automatic,
      reason: "d1_unavailable",
      readiness: null,
      error: "d1_unavailable",
    };
  }
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const sql = getSqlOrNull();
  if (sql) {
    const failover = await probeD1Standby();
    try {
      const rows = await sql`
        WITH required_tables AS (
          SELECT value AS table_name
          FROM jsonb_array_elements_text(${sql.json(REQUIRED_POSTGRES_TABLES)}::jsonb)
        ),
        required_columns AS (
          SELECT item->>'table' AS table_name, item->>'column' AS column_name
          FROM jsonb_array_elements(${sql.json(REQUIRED_POSTGRES_COLUMNS)}::jsonb) item
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
          failover,
        };
      }
      return { mode: "postgres", persistent: true, connected: true, error: null, failover };
    } catch (error) {
      console.error("[trackfleet:storage] postgres health check failed", {
        message: error instanceof Error ? error.message : "Postgres unavailable",
      });
      return {
        mode: "postgres",
        persistent: true,
        connected: false,
        error: "postgres_unavailable",
        failover,
      };
    }
  }

  const db = optionalD1Binding();
  if (db) {
    try {
      await db.prepare("SELECT 1 AS ok").first();
      return { mode: "cloudflare-d1", persistent: true, connected: true, error: null, failover: inactiveFailover() };
    } catch (error) {
      console.error("[trackfleet:storage] D1 health check failed", {
        message: error instanceof Error ? error.message : "D1 unavailable",
      });
      return {
        mode: "cloudflare-d1",
        persistent: true,
        connected: false,
        error: "d1_unavailable",
        failover: inactiveFailover(),
      };
    }
  }

  return { mode: "memory", persistent: false, connected: true, error: null, failover: inactiveFailover() };
}
