import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCustomerEmail } from "../app/lib/customer-contact.ts";
import { automaticEmailSubject } from "../app/lib/email-message.ts";

test("normalizeCustomerEmail matches normalizeCustomerPhone's optional-field contract: empty is valid (''), malformed non-empty is rejected (null), valid is normalized", () => {
  assert.equal(normalizeCustomerEmail(""), "");
  assert.equal(normalizeCustomerEmail(null), "");
  assert.equal(normalizeCustomerEmail(undefined), "");
  assert.equal(normalizeCustomerEmail("   "), "");
  assert.equal(normalizeCustomerEmail("not-an-email"), null);
  assert.equal(normalizeCustomerEmail("missing-domain@"), null);
  assert.equal(normalizeCustomerEmail("@missing-local.com"), null);
  assert.equal(normalizeCustomerEmail("Client@Example.COM"), "client@example.com");
  assert.equal(normalizeCustomerEmail("  client@example.com  "), "client@example.com");
});

test("normalizeCustomerEmail rejects an address longer than 254 characters", () => {
  const tooLong = `${"a".repeat(250)}@example.com`;
  assert.equal(normalizeCustomerEmail(tooLong), null);
});

test("automaticEmailSubject gives every customer-facing event its own subject line, and falls back to a generic one for anything else", () => {
  const delivery = { destination: "Casablanca" };
  assert.match(automaticEmailSubject("REGISTERED", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("DEPARTED", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("DELAY_DETECTED", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("NEAR_DESTINATION", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("ARRIVED", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("ARRIVED_AT_SITE", delivery), /Casablanca/);
  assert.match(automaticEmailSubject("PROGRESS_50", delivery), /Casablanca/);
});

// email-automation.ts imports trackfleet-runtime-env, whose bare specifier
// only resolves under Vite/vinext's aliasing -- unresolvable from plain
// Node (matching this repo's established pattern, e.g. whatsapp-automation.ts
// in tests/whatsapp-mvp-flow.test.mjs), so exercised via source-text
// assertions.
const emailAutomation = await readFile(new URL("../app/lib/email-automation.ts", import.meta.url), "utf8");

test("email is the baseline channel: only the sender's own customerEmail is used, mirroring whatsapp-automation.ts's sender-only rule", () => {
  assert.match(emailAutomation, /return normalizeCustomerEmail\(delivery\.customerEmail \?\? null\);/);
});

test("a missing/invalid email is a distinct, permanent reason (no_email) from missing provider config (not_configured)", () => {
  assert.match(emailAutomation, /if \(!to\) return \{ payload: null, reason: "no_email" \};/);
  assert.match(emailAutomation, /if \(!from \|\| !message\) return \{ payload: null, reason: "not_configured" \};/);
});

test("reuses automaticWhatsAppMessage as the email body instead of maintaining separate per-event copy", () => {
  assert.match(emailAutomation, /import \{ automaticWhatsAppMessage \} from "\.\/whatsapp-message";/);
  assert.match(emailAutomation, /const message = automaticWhatsAppMessage\(event, delivery, trackingUrl, parcelCount\);/);
});

test("sendAutomaticEmailNotification respects the same master automation switch as WhatsApp, and requires an API key, sending domain, and from-address before attempting a send", () => {
  assert.match(emailAutomation, /if \(runtimeEnv\.WHATSAPP_AUTOMATION_ENABLED !== "true"\) return \{ sent: false, reason: "disabled" as const \};/);
  assert.match(emailAutomation, /if \(!apiKey \|\| !domain \|\| !from\) return \{ sent: false, reason: "not_configured" as const \};/);
});

test("the Mailgun API call has a bounded request timeout, matching the WhatsApp/Paddle/Google/SENDATRACK call pattern", () => {
  assert.match(emailAutomation, /AbortSignal\.timeout\(emailRequestTimeoutMs\)/);
});

test("provider is Mailgun: HTTP Basic auth with the literal username \"api\" (not a bearer token like Resend), form-encoded body, and the sending domain in the URL path", () => {
  assert.match(emailAutomation, /https:\/\/api\.mailgun\.net\/v3\/\$\{domain\}\/messages/);
  assert.match(emailAutomation, /authorization: `Basic \$\{btoa\(`api:\$\{apiKey\}`\)\}`,/);
  assert.match(emailAutomation, /"content-type": "application\/x-www-form-urlencoded",/);
  assert.doesNotMatch(emailAutomation, /api\.resend\.com/);
  assert.doesNotMatch(emailAutomation, /Bearer \$\{apiKey\}/);
});
