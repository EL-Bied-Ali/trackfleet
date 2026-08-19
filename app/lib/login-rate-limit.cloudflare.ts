import { runtimeEnv } from "trackfleet-runtime-env";
import { loginRateLimitKey } from "./login-rate-limit-key";

const windowMs = 10 * 60_000;
const maxAttempts = 8;

async function ensureTable() {
  const db = runtimeEnv.DB;
  if (!db) return null;
  await db.prepare(`CREATE TABLE IF NOT EXISTS login_rate_limits (
    client_key text PRIMARY KEY NOT NULL,
    window_started_at integer NOT NULL,
    attempts integer NOT NULL,
    updated_at integer NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_login_rate_limits_updated_at ON login_rate_limits(updated_at)").run();
  return db;
}

export async function consumeLoginAttempt(request: Request) {
  const db = await ensureTable();
  if (!db || !runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim()) return { allowed: true, retryAfterSeconds: 0, distributed: false };

  const key = await loginRateLimitKey(request);
  const now = Date.now();
  const cutoff = now - windowMs;
  await db.prepare(`INSERT INTO login_rate_limits (client_key, window_started_at, attempts, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      window_started_at = CASE WHEN login_rate_limits.window_started_at < ? THEN excluded.window_started_at ELSE login_rate_limits.window_started_at END,
      attempts = CASE WHEN login_rate_limits.window_started_at < ? THEN 1 ELSE login_rate_limits.attempts + 1 END,
      updated_at = excluded.updated_at`)
    .bind(key, now, now, cutoff, cutoff).run();

  const row = await db.prepare("SELECT attempts, window_started_at AS windowStartedAt FROM login_rate_limits WHERE client_key = ? LIMIT 1")
    .bind(key).first<{ attempts: number; windowStartedAt: number }>();
  if (!row) return { allowed: true, retryAfterSeconds: 0, distributed: true };
  const retryAfterSeconds = Math.max(1, Math.ceil((row.windowStartedAt + windowMs - now) / 1000));
  return { allowed: Number(row.attempts) <= maxAttempts, retryAfterSeconds, distributed: true };
}

export async function clearLoginAttempts(request: Request) {
  const db = await ensureTable();
  if (!db || !runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim()) return;
  const key = await loginRateLimitKey(request);
  await db.prepare("DELETE FROM login_rate_limits WHERE client_key = ?").bind(key).run();
}
