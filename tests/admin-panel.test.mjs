import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listCompaniesWithSubscriptions, getCompanyCredentialsCiphertext } from "../app/lib/subscription-store.ts";
import { logAdminAction } from "../app/lib/admin-audit-log.ts";
import { REQUIRED_POSTGRES_TABLES } from "../app/lib/storage-schema-contract.ts";

// admin-auth.ts imports trackfleet-runtime-env, whose bare specifier only
// resolves under Vite/vinext's aliasing -- unresolvable from plain Node
// (matching this repo's established pattern for every other runtimeEnv-
// dependent module), so exercised via source-text assertions.
const [
  adminAuth,
  startRoute,
  callbackRoute,
  sessionRoute,
  companiesRoute,
  subscriptionRoute,
  impersonateRoute,
  adminPage,
] = await Promise.all([
  readFile(new URL("../app/lib/admin-auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/admin/google/start/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/admin/google/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/companies/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/companies/subscription/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/companies/impersonate/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
]);

test("admin_audit_log is part of the production schema contract, and logAdminAction writes to it", () => {
  assert.ok(REQUIRED_POSTGRES_TABLES.includes("admin_audit_log"));
  assert.match(logAdminAction.toString(), /INSERT INTO admin_audit_log/);
});

test("the company list and credentials lookup are real functions usable without a runtimeEnv dependency", () => {
  assert.equal(typeof listCompaniesWithSubscriptions, "function");
  assert.equal(typeof getCompanyCredentialsCiphertext, "function");
});

test("admin sessions are a completely separate trust boundary from company sessions: their own cookie name, their own domain-separated signing key, never layered onto CompanySession", () => {
  assert.match(adminAuth, /const cookieName = "__Host-trackfleet_admin_session";/);
  assert.match(adminAuth, /trackfleet-admin-session:\$\{secret\}/);
  assert.doesNotMatch(adminAuth, /import .*CompanySession/);
  assert.doesNotMatch(adminAuth, /: CompanySession/);
});

test("the admin allowlist is re-checked on every single request, not just at token issuance -- removing an email from ADMIN_EMAILS must revoke access immediately even for an already-issued, still-unexpired token", () => {
  assert.match(adminAuth, /export function isAllowedAdminEmail/);
  const getAdminEmailBody = adminAuth.slice(adminAuth.indexOf("export async function getAdminEmail"));
  assert.match(getAdminEmailBody, /!isAllowedAdminEmail\(payload\.email\)/);
});

test("admin sign-in rejects a non-allowlisted Google account outright -- there is no pending-link/fallback flow like the regular company Google sign-in has", () => {
  assert.match(callbackRoute, /if \(!isAllowedAdminEmail\(identity\.email\)\)/);
  assert.match(callbackRoute, /admin_error=not_allowed/);
  assert.doesNotMatch(callbackRoute, /createGooglePendingLinkToken/);
});

test("the admin OAuth start route requires same-origin and the callback deliberately doesn't (it's Google's own cross-site redirect back to us)", () => {
  assert.match(startRoute, /requestIsSameOrigin\(request\)/);
  assert.doesNotMatch(callbackRoute, /requestIsSameOrigin\(request\)/);
  assert.match(callbackRoute, /state !== cookieState/);
});

test("every admin API route requires a verified admin session before doing anything", () => {
  for (const route of [sessionRoute, companiesRoute, subscriptionRoute, impersonateRoute]) {
    assert.match(route, /getAdminEmail\(request\)/);
  }
});

test("the mutating admin routes (subscription override, impersonate) require same-origin", () => {
  assert.match(subscriptionRoute, /requestIsSameOrigin\(request\)/);
  assert.match(impersonateRoute, /requestIsSameOrigin\(request\)/);
});

test("impersonation reuses createCompanySession/decryptCredentials -- the exact same functions a real login and the Google-link flow use -- rather than a separate, less-verified path into a company's data", () => {
  assert.match(impersonateRoute, /import \{ createCompanySession, decryptCredentials \} from/);
  assert.match(impersonateRoute, /const credentials = await decryptCredentials\(ciphertext\)/);
  assert.match(impersonateRoute, /const result = await createCompanySession\(credentials\)/);
});

test("both impersonation and subscription overrides are logged to the audit trail, since both are genuinely sensitive admin actions", () => {
  assert.match(impersonateRoute, /logAdminAction\(\{ adminEmail: email, action: "impersonate", targetCompanyId: companyId \}\)/);
  assert.match(subscriptionRoute, /logAdminAction\(\{ adminEmail: email, action: "subscription_override"/);
});

test("an audit log write failure never blocks the underlying admin action -- it's caught and reported, not awaited into the response path", () => {
  for (const route of [subscriptionRoute, impersonateRoute]) {
    assert.match(route, /logAdminAction\([^)]*\)\s*\n\s*\.catch\(/);
  }
});

test("a subscription override only accepts one of the real, known subscription statuses -- not an arbitrary string that could put the database in a state the rest of the app doesn't understand", () => {
  assert.match(subscriptionRoute, /const validStatuses: SubscriptionStatus\[\] = \["grandfathered", "trialing", "active", "past_due", "canceled"\];/);
  assert.match(subscriptionRoute, /isSubscriptionStatus\(status\)/);
});

test("the admin page checks its own session endpoint and shows a distinct sign-in screen, never assuming a regular dispatcher session implies admin access", () => {
  assert.match(adminPage, /fetch\("\/api\/admin\/session"/);
  assert.match(adminPage, /href="\/api\/auth\/admin\/google\/start"/);
});

test("the admin company table renders each company's plan, not just its subscription status -- the API already returns plan (see subscription-store.ts), it was previously fetched into state and never rendered", () => {
  assert.match(adminPage, /<th style=\{\{ padding: 8 \}\}>Plan<\/th>/);
  assert.match(adminPage, /<td style=\{\{ padding: 8 \}\}>\{company\.plan \?\? "—"\}<\/td>/);
});
