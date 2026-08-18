import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/whatsapp/preflight/route.ts", import.meta.url), "utf8");

test("WhatsApp production preflight requires an authenticated company session", () => {
  assert.match(route, /getCompanySession\(request\)/);
  assert.match(route, /authentication_required/);
});

test("WhatsApp production preflight never returns provider secrets", () => {
  assert.doesNotMatch(route, /accessToken:/);
  assert.doesNotMatch(route, /WHATSAPP_ACCESS_TOKEN[^\n]*,/);
  assert.match(route, /cache-control/);
  assert.match(route, /noindex, nofollow, noarchive/);
});

test("WhatsApp production preflight verifies all launch-critical dependencies", () => {
  assert.match(route, /persistentStorage:/);
  assert.match(route, /schedulerProtected:/);
  assert.match(route, /providerConfigured:/);
  assert.match(route, /businessAccountConfigured:/);
  assert.match(route, /phoneNumberVerified:/);
  assert.match(route, /templateApproved:/);
  assert.match(route, /templateContractMatches:/);
  assert.match(route, /readyToEnable/);
  assert.match(route, /readyToRun/);
});

test("WhatsApp production preflight keeps activation separate from provider verification", () => {
  assert.match(route, /activationConfigured/);
  assert.match(route, /set_automation_start_at/);
  assert.match(route, /enable_automation/);
  assert.match(route, /wait_for_approved_template/);
});
