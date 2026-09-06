import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  auditLogLib, schemaContract, companyAuth, googleCallbackRoute, googleLinkRoute,
  deliveriesRoute, manualCompletionRoute, scanRoute, auditLogRoute, historyPage,
] = await Promise.all([
  readFile(new URL("../app/lib/company-audit-log.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/company-auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/google/link/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/operations/audit-log/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/operations/history/page.tsx", import.meta.url), "utf8"),
]);

// --- Auth: Google identity threaded into the session ---

test("createCompanySession accepts an optional googleEmail and uses it as the session's userLabel instead of the shared credential's user field", () => {
  assert.match(companyAuth, /export async function createCompanySession\(credentials: SendatrackCredentials, googleEmail\?: string\)/);
  assert.match(companyAuth, /userLabel: googleEmail\?\.trim\(\) \|\| normalized\.user,/);
});

test("password login (the plain login route) never passes a googleEmail -- a shared password-login session still shows the generic account user", async () => {
  const loginRoute = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const callIndex = loginRoute.indexOf("createCompanySession(");
  assert.ok(callIndex >= 0);
  const call = loginRoute.slice(callIndex, callIndex + 200);
  assert.doesNotMatch(call, /identity\.email/);
});

test("both Google login paths (returning callback, first-time link) pass their own resolved identity's email through to createCompanySession", () => {
  assert.match(googleCallbackRoute, /createCompanySession\(credentials, identity\.email\)/);
  assert.match(googleLinkRoute, /\}, identity\.email\);/);
});

// --- New audit-log table + helper ---

test("company_audit_log is declared in the schema contract, so the pre-deploy gate verifies it exists in production", () => {
  assert.match(schemaContract, /"company_audit_log",/);
});

test("company-audit-log.ts's ensureSchema is NOT gated behind TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP -- unlike delivery-store.postgres.ts's big schema, this is one small table that's meant to self-heal at request time", () => {
  assert.doesNotMatch(auditLogLib, /runtimeSchemaBootstrapEnabled/);
  assert.match(auditLogLib, /CREATE TABLE IF NOT EXISTS company_audit_log/);
});

test("logCompanyAction never throws back to its caller -- a logging failure must not block the underlying dispatcher action", () => {
  const fnStart = auditLogLib.indexOf("export async function logCompanyAction");
  const fnBody = auditLogLib.slice(fnStart, fnStart + 900);
  assert.match(fnBody, /try \{/);
  assert.match(fnBody, /\} catch \(error\) \{/);
  assert.doesNotMatch(fnBody, /throw error/);
});

test("listCompanyAuditLog uses keyset pagination scoped to the company, newest first, never OFFSET", () => {
  assert.match(auditLogLib, /WHERE company_id = \$\{companyId\} AND id < \$\{beforeId\}/);
  assert.match(auditLogLib, /ORDER BY id DESC LIMIT/);
  assert.doesNotMatch(auditLogLib, /\bOFFSET\b/i);
});

test("the three sensitive-action types are exactly delivery_deleted and the two arrival-confirm bypass paths", () => {
  assert.match(auditLogLib, /"delivery_deleted"/);
  assert.match(auditLogLib, /"arrival_confirmed_missing_scans_bypassed"/);
  assert.match(auditLogLib, /"arrival_confirmed_location_mismatch_bypassed"/);
});

// --- Wiring: the three routes actually log an actor now ---

test("deleting a delivery snapshots its customer/destination BEFORE the delete (the row is gone after), then logs the actor", () => {
  const snapshotIndex = deliveriesRoute.indexOf("const target = (await store.listForCompany");
  const deleteIndex = deliveriesRoute.indexOf("const deleted = await store.deleteDelivery(");
  const logIndex = deliveriesRoute.indexOf('action: "delivery_deleted"');
  assert.ok(snapshotIndex >= 0 && deleteIndex > snapshotIndex && logIndex > deleteIndex, "expected: snapshot fetched, then delete, then the audit log write");
  assert.match(deliveriesRoute, /actor: session\.userLabel, action: "delivery_deleted"/);
});

test("the missing-scans arrival bypass now logs an actor alongside its existing console.warn, not instead of it", () => {
  assert.match(manualCompletionRoute, /console\.warn\("\[trackfleet:deliveries\] arrival confirmed despite missing scans \(explicit bypass\)", \{/);
  assert.match(manualCompletionRoute, /action: "arrival_confirmed_missing_scans_bypassed"/);
  assert.match(manualCompletionRoute, /actor: session\.userLabel/);
});

test("the location-mismatch scan bypass logs an actor alongside its existing delivery_events marker, not instead of it", () => {
  assert.match(scanRoute, /await store\.recordEvent\(delivery\.id, "ARRIVAL_LOCATION_MISMATCH_BYPASSED", delivery\.progress\);\s*\n\s*await logCompanyAction\(\{/);
  assert.match(scanRoute, /action: "arrival_confirmed_location_mismatch_bypassed"/);
});

// --- Read endpoint ---

test("the audit-log read endpoint is dispatcher-only, same gate as delete-delivery, and validates its cursor", () => {
  assert.match(auditLogRoute, /getDispatcherSession\(request\)/);
  assert.match(auditLogRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401\);/);
  assert.match(auditLogRoute, /!Number\.isInteger\(beforeId\)/);
});

// --- UI ---

test("the Historique page renders the sensitive-actions section only when it actually has entries, and stays silent (no error) for a viewer the endpoint 401s", () => {
  assert.match(historyPage, /fetch\(`\/api\/operations\/audit-log\$\{query\}`, \{ cache: "no-store" \}\)/);
  assert.match(historyPage, /if \(!response\.ok\) \{ setAuditVisible\(false\); return; \}/);
  assert.match(historyPage, /\{auditVisible && auditItems\.length > 0 && \(/);
});

test("the sensitive-actions table shows who did it, what, and the delivery it touched", () => {
  const sectionStart = historyPage.indexOf("auditVisible && auditItems.length > 0");
  const section = historyPage.slice(sectionStart, sectionStart + 1500);
  assert.match(section, /\{entry\.actor\}/);
  assert.match(section, /\{auditActionLabel\(entry\)\}/);
  assert.match(section, /entry\.deliveryCustomer/);
});
