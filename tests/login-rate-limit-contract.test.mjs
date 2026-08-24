import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const keySource = fs.readFileSync("app/lib/login-rate-limit-key.ts", "utf8");
const vercelSource = fs.readFileSync("app/lib/login-rate-limit.vercel.ts", "utf8");
const sharedPostgresSource = fs.readFileSync("app/lib/login-rate-limit.shared-postgres.ts", "utf8");
const cloudflareSource = fs.readFileSync("app/lib/login-rate-limit.cloudflare.ts", "utf8");
const loginRoute = fs.readFileSync("app/api/auth/login/route.ts", "utf8");
const viteConfig = fs.readFileSync("vite.config.ts", "utf8");
const tsconfigVercel = fs.readFileSync("tsconfig.vercel.json", "utf8");

test("login rate limit keys pseudonymize client addresses with HMAC", () => {
  assert.match(keySource, /HMAC/);
  assert.match(keySource, /SHA-256/);
  assert.match(keySource, /TRACKFLEET_ENCRYPTION_KEY/);
  assert.match(keySource, /x-forwarded-for/);
  assert.equal(keySource.includes("console.log"), false);
});

test("the client address trusts Cloudflare's own cf-connecting-ip before any client-suppliable header", () => {
  // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by the
  // client (Cloudflare overwrites any client-supplied header with that exact
  // name). x-forwarded-for is client-suppliable -- a client can prepend an
  // arbitrary value to that list -- so trusting it alone lets an attacker
  // rotate a fake value per request and bypass rate limiting entirely.
  assert.match(keySource, /cf-connecting-ip/);
  const cfIndex = keySource.indexOf("cf-connecting-ip");
  const forwardedIndex = keySource.indexOf("x-forwarded-for");
  assert.ok(cfIndex >= 0 && forwardedIndex >= 0 && cfIndex < forwardedIndex, "cf-connecting-ip must be checked before the spoofable x-forwarded-for fallback");
  assert.match(keySource, /export function clientAddress/, "clientAddress must be exported so callers share one implementation instead of duplicating it");
});

test("the login route reuses the shared clientAddress instead of its own duplicate IP-extraction logic", () => {
  // A second, independent copy of this logic in the route itself is exactly
  // how the cf-connecting-ip gap went unnoticed in one copy while the other
  // (login-rate-limit-key.ts) could be fixed in isolation -- keep it to one
  // implementation.
  assert.match(loginRoute, /import \{ clientAddress \} from ["']\.\.\/\.\.\/\.\.\/lib\/login-rate-limit-key["']/);
  assert.doesNotMatch(loginRoute, /x-forwarded-for/);
  assert.doesNotMatch(loginRoute, /function clientKey/);
});

test("shared Postgres runtime uses an atomic Neon rate limit counter", () => {
  assert.match(sharedPostgresSource, /login-rate-limit\.vercel/);
  assert.match(vercelSource, /CREATE TABLE IF NOT EXISTS login_rate_limits/);
  assert.match(vercelSource, /ON CONFLICT \(client_key\) DO UPDATE/);
  assert.match(vercelSource, /attempts \+ 1/);
  assert.match(vercelSource, /attempts <= maxAttempts/);
  assert.match(vercelSource, /DELETE FROM login_rate_limits/);
  assert.equal(vercelSource.includes("x-forwarded-for"), false, "raw client addresses must not reach the persistence module");
});

test("Cloudflare D1 uses the same atomic rate limit policy", () => {
  assert.match(cloudflareSource, /INSERT INTO login_rate_limits/);
  assert.match(cloudflareSource, /ON CONFLICT\(client_key\) DO UPDATE/);
  assert.match(cloudflareSource, /login_rate_limits\.attempts \+ 1/);
  assert.match(cloudflareSource, /Number\(row\.attempts\) <= maxAttempts/);
  assert.match(cloudflareSource, /DELETE FROM login_rate_limits/);
});

test("login route prefers distributed limits and fails safely to bounded local protection", () => {
  assert.match(loginRoute, /consumeLoginAttempt/);
  assert.match(loginRoute, /decision\.distributed/);
  assert.match(loginRoute, /allowLocalLoginAttempt/);
  assert.match(loginRoute, /clearLoginAttempts/);
  assert.match(loginRoute, /retry-after/);
  assert.match(loginRoute, /too_many_login_attempts/);
});

test("runtime aliases resolve the correct rate limiter on shared Postgres and Cloudflare", () => {
  assert.match(viteConfig, /trackfleet-login-rate-limit/);
  assert.match(viteConfig, /login-rate-limit\.shared-postgres\.ts/);
  assert.match(viteConfig, /login-rate-limit\.cloudflare\.ts/);
  assert.match(tsconfigVercel, /trackfleet-login-rate-limit/);
});
