import { runtimeEnv } from "trackfleet-runtime-env";

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
      await sql`SELECT 1 AS ok`;
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
