import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/whatsapp/preflight/route.ts", import.meta.url), "utf8");

test("WhatsApp production preflight requires an authenticated company session", () => {
  assert.match(route, /getDispatcherSession\(request\)/);
  assert.match(route, /authentication_required/);
});

test("WhatsApp production preflight never returns provider secrets", () => {
  assert.doesNotMatch(route, /accessToken:/);
  assert.doesNotMatch(route, /WHATSAPP_ACCESS_TOKEN[^\n]*,/);
  assert.match(route, /cache-control/);
  assert.match(route, /noindex, nofollow, noarchive/);
});

test("unexpected preflight failures are logged but sanitized for callers", () => {
  assert.match(route, /console\.error\("\[trackfleet:whatsapp\] preflight verification failed", \{ message \}\)/);
  assert.match(route, /providerError = "provider_verification_failed"/);
  assert.doesNotMatch(route, /providerError = error instanceof Error \? error\.message/);
});

test("WhatsApp production preflight verifies all launch-critical dependencies", () => {
  assert.match(route, /persistentStorage:/);
  assert.match(route, /sessionEncryptionConfigured:/);
  assert.match(route, /sessionEncryptionKeyConfigured/);
  assert.match(route, /sendatrackConfigured:/);
  assert.match(route, /sendatrackTransportSecure:/);
  assert.match(route, /sendatrackTransportIsSecure/);
  assert.match(route, /schedulerProtected:/);
  assert.match(route, /providerConfigured:/);
  assert.match(route, /businessAccountConfigured:/);
  assert.match(route, /phoneNumberVerified:/);
  assert.match(route, /templateApiAccessible:/);
  assert.match(route, /templateApproved:/);
  assert.match(route, /templateContractMatches:/);
  assert.match(route, /readyToEnable/);
  assert.match(route, /readyToRun/);
});

test("WhatsApp production preflight gives actionable infrastructure next steps", () => {
  assert.match(route, /configure_session_encryption_key/);
  assert.match(route, /configure_sendatrack/);
  assert.match(route, /configure_sendatrack_https/);
  assert.match(route, /configure_cron_secret/);
});

test("WhatsApp production preflight distinguishes API access, approval and template shape", () => {
  assert.match(route, /provider\?\.templateApproved === true/);
  assert.match(route, /verify_whatsapp_template_access/);
  assert.match(route, /wait_for_approved_template/);
  assert.match(route, /fix_template_body_parameters/);
  assert.match(route, /observedBodyParameters/);
});

test("WhatsApp production preflight keeps activation separate from provider verification", () => {
  assert.match(route, /activationConfigured/);
  assert.match(route, /set_automation_start_at/);
  assert.match(route, /enable_automation/);
});
