import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, page, css, d1Schema, contract, failover] = await Promise.all([
  readFile(new URL("../app/api/company/automation-settings/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/auth-session-store.cloudflare-postgres-failover.ts", import.meta.url), "utf8"),
]);

test("automation settings are readable by any authenticated session, but only a dispatcher can edit them", () => {
  assert.match(route, /export async function GET\(request: Request\) \{\s*const session = await getCompanySession\(request\);/s);
  assert.match(route, /export async function POST\(request: Request\) \{\s*if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);\s*const session = await getDispatcherSession\(request\);/s);
});

test("the update route rejects an unload grace period outside [15, 720] minutes and a CTM relay grace period outside [60, 10080] minutes", () => {
  assert.match(route, /parsed < MIN_UNLOAD_GRACE_MINUTES \|\| parsed > MAX_UNLOAD_GRACE_MINUTES/);
  assert.match(route, /return noStore\(\{ error: "invalid_unload_grace_minutes" \}, 400\);/);
  assert.match(route, /parsed < MIN_CTM_RELAY_GRACE_MINUTES \|\| parsed > MAX_CTM_RELAY_GRACE_MINUTES/);
  assert.match(route, /return noStore\(\{ error: "invalid_ctm_relay_grace_minutes" \}, 400\);/);
});

test("a null/omitted field clears that override back to the deploy-wide default, rather than being rejected", () => {
  assert.match(route, /unloadGraceMinutes: number \| null = null;/);
  assert.match(route, /ctmRelayGraceMinutes: number \| null = null;/);
  assert.match(route, /payload\.ctmRelayAutoCompletionEnabled === null \|\| payload\.ctmRelayAutoCompletionEnabled === undefined\s*\?\s*null/);
});

test("the settings modal exposes a CTM relay auto-completion toggle plus the two grace-period fields, and disables the CTM field when the toggle is off", () => {
  assert.match(page, /<label className="toggle-switch"><input type="checkbox" checked=\{companySettingsCtmRelayAutoEnabled\} onChange=\{\(event\) => setCompanySettingsCtmRelayAutoEnabled\(event\.target\.checked\)\} aria-label=\{.*?\} \/><span \/><\/label>/);
  assert.match(page, /<input type="number" min=\{15\} max=\{720\} value=\{companySettingsUnloadGraceMinutes\}/);
  assert.match(page, /<input type="number" min=\{1\} max=\{168\} value=\{companySettingsCtmRelayGraceHours\}.*disabled=\{!companySettingsCtmRelayAutoEnabled\}/);
});

test("opening company settings fetches the current automation settings and skips the save on a failed fetch, to avoid silently wiping an existing override", () => {
  assert.match(page, /const response = await fetch\("\/api\/company\/automation-settings", \{ cache: "no-store" \}\);/);
  assert.match(page, /if \(!companySettingsAutomationLoadFailed\) \{/);
});

test("the CTM relay grace period is submitted in hours from the UI but stored/sent in minutes", () => {
  assert.match(page, /ctmRelayGraceMinutes: trimmedCtmRelayHours === "" \? null : Number\(trimmedCtmRelayHours\) \* 60,/);
});

test("automation settings columns are provisioned in both the Postgres schema contract and the D1 standby's self-healing schema script", () => {
  assert.match(contract, /\{ table: "companies", column: "unload_grace_minutes" \}/);
  assert.match(contract, /\{ table: "companies", column: "ctm_relay_grace_minutes" \}/);
  assert.match(contract, /\{ table: "companies", column: "ctm_relay_auto_completion_enabled" \}/);
  assert.match(d1Schema, /\["unload_grace_minutes", "integer"\]/);
  assert.match(d1Schema, /\["ctm_relay_grace_minutes", "integer"\]/);
  assert.match(d1Schema, /\["ctm_relay_auto_completion_enabled", "integer"\]/);
});

test("automation settings writes are suppressed (not silently lost) during an active D1 failover, matching branding", () => {
  assert.match(failover, /export async function updateCompanyAutomationSettings\(companyId: string, input: CompanyAutomationSettings\) \{\s*return suppressMaintenanceWriteDuringD1Failover\(/s);
  assert.match(failover, /export async function getCompanyAutomationSettings\(companyId: string\): Promise<CompanyAutomationSettings \| null> \{\s*return withD1ReadFailover\(/s);
});

test("the toggle switch is a real checkbox styled as a slider, so it stays keyboard-accessible", () => {
  assert.match(css, /\.toggle-switch input:focus-visible \+ span \{ outline: 2px solid var\(--green\); outline-offset: 2px; \}/);
});
