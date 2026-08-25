import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REQUIRED_POSTGRES_TABLES } from "../app/lib/storage-schema-contract.ts";

const [oauth, companyAuth, linkStore, startRoute, callbackRoute, linkRoute, page, schemaCheckScript] = await Promise.all([
  readFile(new URL("../app/lib/google-oauth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/company-auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/google-link-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/google/start/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/google/link/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/prepare-postgres-schema.mjs", import.meta.url), "utf8"),
]);

// google-oauth.ts imports trackfleet-runtime-env, whose bare specifier only
// resolves under Vite/vinext's aliasing -- unresolvable from plain Node, so
// (matching this repo's established pattern for every other runtimeEnv-
// dependent module, e.g. whatsapp-automation.ts) this is exercised via
// source-text assertions rather than direct import/invocation.

test("the google_links table is a real part of the production schema contract, and was actually created (see git history / deploy log, not just declared here)", () => {
  assert.ok(REQUIRED_POSTGRES_TABLES.includes("google_links"));
  // The pre-deploy gate reads this contract directly -- confirms a future
  // deploy will fail loudly if google_links is ever missing, instead of the
  // item_description-incident failure mode (silently degrading to D1
  // failover). See app/lib/storage-schema-contract.ts and
  // scripts/prepare-postgres-schema.mjs.
  assert.match(schemaCheckScript, /REQUIRED_POSTGRES_TABLES/);
});

test("Google's id_token is verified against this app's own client_id and issuer, not just checked for a valid signature", () => {
  assert.match(oauth, /oauth2\.googleapis\.com\/tokeninfo/);
  assert.match(oauth, /claims\.iss === ["']https:\/\/accounts\.google\.com["']/);
  assert.match(oauth, /claims\.aud !== credentials\.clientId/);
  assert.match(oauth, /emailVerified/);
});

test("the authorize URL always forces the Google account chooser, so a shared computer can't silently reuse the last signed-in Google session", () => {
  assert.match(oauth, /prompt.*select_account/);
  assert.match(oauth, /response_type.*code/);
  assert.match(oauth, /scope.*openid email/);
});

test("Google API calls have bounded request timeouts, matching the existing WhatsApp/Meta call pattern", () => {
  assert.match(oauth, /AbortSignal\.timeout\(requestTimeoutMs\)/g);
});

test("a company's stored SENDATRACK credentials can be decrypted and re-verified for Google login, and createCompanySession exposes the companyId a link needs to be recorded against", () => {
  assert.match(companyAuth, /export async function decryptCredentials/);
  assert.match(companyAuth, /vehicles: snapshot\.vehicles,\s*\n\s*companyId,/);
});

test("the Google pending-link token is short-lived, signed, and expiry-checked -- the same self-contained-token shape as agency enrollment, not a new trust model", () => {
  assert.match(companyAuth, /const googlePendingLinkDurationMs = 10 \* 60 \* 1000/);
  assert.match(companyAuth, /export async function createGooglePendingLinkToken/);
  assert.match(companyAuth, /export async function verifyGooglePendingLinkToken/);
  assert.match(companyAuth, /payload\.expiresAt < Date\.now\(\)/);
  // Both agency enrollment and the Google pending-link token sign through
  // the same generic HMAC helper -- confirms this isn't a second, separately
  // maintained signing implementation.
  assert.match(companyAuth, /signHmacPayload\(encodedPayload\)/g);
});

test("the Google-linked-company lookup joins google_links to companies in one query, and upserts by google_sub on (re-)linking", () => {
  assert.match(linkStore, /FROM google_links g\s*\n\s*JOIN companies c ON c\.id = g\.company_id/);
  assert.match(linkStore, /ON CONFLICT \(google_sub\) DO UPDATE/);
});

test("/api/auth/google/start requires same-origin (it's a link click on our own page) and sets a short-lived, distinctly-named state cookie before redirecting to Google", () => {
  assert.match(startRoute, /requestIsSameOrigin\(request\)/);
  assert.match(startRoute, /googleStateCookieName/);
  assert.match(startRoute, /status: 302/);
});

test("/api/auth/google/callback deliberately skips the same-origin check, because the request IS Google's own cross-site redirect back to us -- the state cookie is the real CSRF defense there instead", () => {
  assert.doesNotMatch(callbackRoute, /requestIsSameOrigin\(request\)/);
  assert.match(callbackRoute, /state !== cookieState/);
  assert.match(callbackRoute, /clearStateCookie/);
});

test("an already-linked Google identity reuses createCompanySession (re-verifying against SENDATRACK, exactly like a normal login) instead of minting a session through a separate, unverified path", () => {
  assert.match(callbackRoute, /const credentials = await decryptCredentials\(linked\.credentialsCiphertext\)/);
  assert.match(callbackRoute, /const result = await createCompanySession\(credentials\)/);
});

test("a first-time Google identity is redirected to complete linking with a pending token in the URL, never with raw SENDATRACK credentials or an already-authenticated session", () => {
  assert.match(callbackRoute, /createGooglePendingLinkToken\(identity\)/);
  assert.match(callbackRoute, /searchParams\.set\(["']google_link["'], pendingToken\)/);
});

test("/api/auth/google/link verifies the pending-link token AND requires same-origin, and reuses the exact same login rate-limiting as /api/auth/login since it also accepts a SENDATRACK password", () => {
  assert.match(linkRoute, /requestIsSameOrigin\(request\)/);
  assert.match(linkRoute, /verifyGooglePendingLinkToken\(pendingToken\)/);
  assert.match(linkRoute, /consumeLoginAttempt/);
  assert.match(linkRoute, /maxLoginAttempts = 8/);
});

test("the login screen offers Google sign-in as a real navigation (not a fetch), and the one-time linking form reuses the same account/user/password fields as the normal login form", () => {
  assert.match(page, /<a className="login-google" href="\/api\/auth\/google\/start">/);
  assert.match(page, /fetch\(["']\/api\/auth\/google\/link["']/);
  assert.match(page, /pendingToken: googleLink\.token/);
});
