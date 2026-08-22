import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const companyAuth = fs.readFileSync("app/lib/company-auth.ts", "utf8");
const vercelStore = fs.readFileSync("app/lib/auth-session-store.vercel.ts", "utf8");
const cloudflareStore = fs.readFileSync("app/lib/auth-session-store.cloudflare.ts", "utf8");
const schema = fs.readFileSync("db/schema.ts", "utf8");
const viteConfig = fs.readFileSync("vite.config.ts", "utf8");
const vercelTsconfig = fs.readFileSync("tsconfig.vercel.json", "utf8");

test("browser session cookie contains only an opaque random token", () => {
  assert.match(companyAuth, /const token = randomToken\(32\)/);
  assert.match(companyAuth, /trackfleet-session-token:\$\{token\}/);
  assert.match(companyAuth, /cookie: `\$\{cookieName\}=\$\{token\}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(companyAuth, /SessionPayload/);
  assert.doesNotMatch(companyAuth, /encryptPayload\(\{ \.\.\.normalized, expiresAt \}\)/);
});

test("SENDATRACK credentials are encrypted before entering server session storage", () => {
  assert.match(companyAuth, /encryptCredentials\(normalized\)/);
  assert.match(companyAuth, /AES-GCM/);
  assert.match(companyAuth, /credentialsCiphertext/);
  assert.match(companyAuth, /createServerSession/);
  assert.match(companyAuth, /getServerSession/);
  assert.match(companyAuth, /deleteServerSession/);
});

test("server session lookup hashes the cookie and validates tenant identity", () => {
  assert.match(companyAuth, /sha256\(`trackfleet-session-token:\$\{token\}`\)/);
  assert.match(companyAuth, /expectedCompanyId !== stored\.companyId/);
  assert.match(companyAuth, /stored\.expiresAt\.getTime\(\) <= Date\.now\(\)/);
});

test("Neon and D1 persist ciphertext per session rather than plaintext credentials", () => {
  for (const source of [vercelStore, cloudflareStore]) {
    assert.match(source, /credentials_ciphertext/);
    assert.match(source, /token_hash/);
    assert.match(source, /expires_at/);
    assert.doesNotMatch(source, /password text|password varchar|password =/i);
  }
});

test("schema and runtime aliases include opaque server session fields", () => {
  assert.match(schema, /credentialsCiphertext: text\("credentials_ciphertext"\)/);
  assert.match(schema, /accountLabel: text\("account_label"\)/);
  assert.match(schema, /userLabel: text\("user_label"\)/);
  assert.match(viteConfig, /trackfleet-auth-session-store/);
  assert.match(vercelTsconfig, /trackfleet-auth-session-store/);
});

test("sessions renew (extend expires_at) once close to expiring, instead of a flat 7-day cutoff regardless of activity", () => {
  const sharedPostgresStore = fs.readFileSync("app/lib/auth-session-store.shared-postgres.ts", "utf8");
  const failoverStore = fs.readFileSync("app/lib/auth-session-store.cloudflare-postgres-failover.ts", "utf8");
  for (const source of [vercelStore, cloudflareStore, sharedPostgresStore, failoverStore]) {
    assert.match(source, /renewServerSession/);
  }
  // The renewal write itself only touches expires_at -- never re-derives or
  // re-encrypts credentials -- and the D1 mirror is kept in sync too.
  assert.match(vercelStore, /UPDATE sessions SET expires_at = \$\{expiresAt\.toISOString\(\)\} WHERE token_hash = \$\{tokenHash\}/);
  assert.match(cloudflareStore, /UPDATE sessions SET expires_at = \? WHERE token_hash = \?/);
  assert.match(sharedPostgresStore, /mirrorRenew/);

  assert.match(companyAuth, /getCompanySessionWithRenewal/);
  assert.match(companyAuth, /remainingSeconds >= sessionDurationSeconds - sessionRenewalWindowSeconds/);
  // Renewal re-issues the *same* opaque token in a fresh cookie -- it must
  // never mint a new token, which would silently invalidate other tabs/devices
  // using the same session.
  assert.match(companyAuth, /renewedCookie: `\$\{cookieName\}=\$\{resolved\.token\}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\$\{sessionDurationSeconds\}`/);
  // A renewal failure (e.g. Postgres briefly unavailable) degrades to "session
  // still valid this request, just not renewed" -- it must never fail the
  // whole auth check.
  assert.match(companyAuth, /catch \(error\) \{[\s\S]{0,120}session renewal failed/);

  const sessionRoute = fs.readFileSync("app/api/auth/session/route.ts", "utf8");
  assert.match(sessionRoute, /getCompanySessionWithRenewal/);
  assert.match(sessionRoute, /headers\["set-cookie"\] = result\.renewedCookie/);

  const page = fs.readFileSync("app/page.tsx", "utf8");
  assert.match(page, /window\.setInterval\(\(\) => \{\s*\n\s*void fetch\("\/api\/auth\/session", \{ cache: "no-store" \}\)/);
});
