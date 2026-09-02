import { getSqlOrNull } from "./pg-client.ts";
import { runtimeEnv } from "trackfleet-runtime-env";
import { loginRateLimitKey } from "./login-rate-limit-key";

const windowMs = 10 * 60_000;
const maxAttempts = 8;
let schemaPromise: Promise<void> | null = null;

async function ensureSchema() {
  const sql = getSqlOrNull();
  if (!sql) return null;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS login_rate_limits (
        client_key text PRIMARY KEY,
        window_started_at timestamptz NOT NULL,
        attempts integer NOT NULL,
        updated_at timestamptz NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_login_rate_limits_updated_at ON login_rate_limits(updated_at)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

export async function consumeLoginAttempt(request: Request) {
  const sql = await ensureSchema();
  if (!sql || !runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim()) return { allowed: true, retryAfterSeconds: 0, distributed: false };

  const key = await loginRateLimitKey(request);
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await sql`INSERT INTO login_rate_limits (client_key, window_started_at, attempts, updated_at)
    VALUES (${key}, ${now.toISOString()}, 1, ${now.toISOString()})
    ON CONFLICT (client_key) DO UPDATE SET
      window_started_at = CASE WHEN login_rate_limits.window_started_at < ${cutoff.toISOString()} THEN ${now.toISOString()} ELSE login_rate_limits.window_started_at END,
      attempts = CASE WHEN login_rate_limits.window_started_at < ${cutoff.toISOString()} THEN 1 ELSE login_rate_limits.attempts + 1 END,
      updated_at = ${now.toISOString()}
    RETURNING attempts, window_started_at` as Array<{ attempts: number; window_started_at: string | Date }>;

  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0, distributed: true };
  const attempts = Number(row.attempts);
  const started = new Date(row.window_started_at).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((started + windowMs - now.getTime()) / 1000));
  return { allowed: attempts <= maxAttempts, retryAfterSeconds, distributed: true };
}

export async function clearLoginAttempts(request: Request) {
  const sql = await ensureSchema();
  if (!sql || !runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim()) return;
  const key = await loginRateLimitKey(request);
  await sql`DELETE FROM login_rate_limits WHERE client_key = ${key}`;
}
