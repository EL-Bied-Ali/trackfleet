import { runtimeEnv } from "trackfleet-runtime-env";

export type StorageHealth = {
  mode: "postgres" | "cloudflare-d1" | "memory";
  persistent: boolean;
  connected: boolean;
  error: string | null;
};

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

  if (runtimeEnv.DB) {
    try {
      await runtimeEnv.DB.prepare("SELECT 1 AS ok").first();
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
