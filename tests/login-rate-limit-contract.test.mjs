import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const keySource = fs.readFileSync("app/lib/login-rate-limit-key.ts", "utf8");
const vercelSource = fs.readFileSync("app/lib/login-rate-limit.vercel.ts", "utf8");
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

test("Vercel uses an atomic shared Neon rate limit counter", () => {
  assert.match(vercelSource, /CREATE TABLE IF NOT EXISTS login_rate_limits/);
  assert.match(vercelSource, /ON CONFLICT \(client_key\) DO UPDATE/);
  assert.match(vercelSource, /attempts \+ 1/);
  assert.match(vercelSource, /attempts <= maxAttempts/);
  assert.match(vercelSource, /DELETE FROM login_rate_limits/);
  assert.equal(vercelSource.includes("x-forwarded-for"), false, "raw client addresses must not reach the persistence module");
});

test("Cloudflare uses a shared D1 rate limit counter with the same policy", () => {
  assert.match(cloudflareSource, /CREATE TABLE IF NOT EXISTS login_rate_limits/);
  assert.match(cloudflareSource, /ON CONFLICT\(client_key\) DO UPDATE/);
  assert.match(cloudflareSource, /attempts \+ 1/);
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

test("runtime aliases resolve the correct rate limiter on Vercel and Cloudflare", () => {
  assert.match(viteConfig, /trackfleet-login-rate-limit/);
  assert.match(viteConfig, /login-rate-limit\.vercel\.ts/);
  assert.match(viteConfig, /login-rate-limit\.cloudflare\.ts/);
  assert.match(tsconfigVercel, /trackfleet-login-rate-limit/);
});
