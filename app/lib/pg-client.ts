import postgres from "postgres";
import { runtimeEnv, runtimePlatform } from "trackfleet-runtime-env";

type Sql = ReturnType<typeof postgres>;

// A TCP client tied to a Cloudflare Hyperdrive binding cannot be cached at
// module scope and reused across requests -- Workers treats I/O objects as
// request-scoped, and doing so risks "Cannot perform I/O on behalf of a
// different request". Hyperdrive itself keeps real connections pooled at
// Cloudflare's edge, so constructing a fresh client per call here is cheap
// and correct. This replaces Neon's neon() driver, which was a stateless
// HTTP client safe to cache -- that assumption no longer holds now that a
// standard Postgres provider is reached over TCP via Hyperdrive.
function resolveConnectionString(): string | null {
  if ((runtimePlatform as string) === "cloudflare") {
    const hyperdrive = (runtimeEnv as unknown as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;
    return runtimeEnv.DATABASE_URL?.trim() || null;
  }
  return runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
}

function buildClient(connectionString: string): Sql {
  return postgres(connectionString, {
    max: 5,
    prepare: true,
    fetch_types: true,
    idle_timeout: 20,
  });
}

export function getSql(): Sql {
  const connectionString = resolveConnectionString();
  if (!connectionString) throw new Error("DATABASE_URL/HYPERDRIVE is required for Postgres access");
  return buildClient(connectionString);
}

export function getSqlOrNull(): Sql | null {
  const connectionString = resolveConnectionString();
  return connectionString ? buildClient(connectionString) : null;
}
