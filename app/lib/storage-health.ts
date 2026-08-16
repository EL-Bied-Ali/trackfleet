export type StorageHealth = {
  mode: "postgres" | "cloudflare-d1" | "memory";
  persistent: boolean;
  connected: boolean;
  error: string | null;
};

export async function getStorageHealth(): Promise<StorageHealth> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    try {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(databaseUrl);
      await sql`SELECT 1 AS ok`;
      return { mode: "postgres", persistent: true, connected: true, error: null };
    } catch (error) {
      return {
        mode: "postgres",
        persistent: true,
        connected: false,
        error: error instanceof Error ? error.message : "Postgres unavailable",
      };
    }
  }

  // Cloudflare's D1 binding is injected through the runtime adapter rather than
  // process.env. This marker is best-effort; the D1 delivery store performs the
  // authoritative check when it is used.
  if (process.env.CF_PAGES || process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { mode: "cloudflare-d1", persistent: true, connected: true, error: null };
  }

  return { mode: "memory", persistent: false, connected: true, error: null };
}
