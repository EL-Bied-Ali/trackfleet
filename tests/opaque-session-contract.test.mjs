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
