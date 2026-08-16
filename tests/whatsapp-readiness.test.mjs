import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [demoRoute, readinessRoute, readinessHelper, vercelEnv, cloudflareEnv] = await Promise.all([
  readFile(new URL("../app/api/whatsapp/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/whatsapp/readiness/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-readiness.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/runtime-env.vercel.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/runtime-env.cloudflare.ts", import.meta.url), "utf8"),
]);

test("manual WhatsApp demo requires auth, explicit opt-in and explicit template", () => {
  assert.match(demoRoute, /getCompanySession\(request\)/);
  assert.match(demoRoute, /authentication_required/);
  assert.match(demoRoute, /WHATSAPP_DEMO_ENABLED !== ["']true["']/);
  assert.match(demoRoute, /whatsapp_demo_disabled/);
  assert.match(demoRoute, /WHATSAPP_TEMPLATE_NAME\?\.trim\(\)/);
  assert.doesNotMatch(demoRoute, /jaspers_market_order_confirmation_v1/);
});

test("WhatsApp readiness endpoint is authenticated", () => {
  assert.match(readinessRoute, /getCompanySession\(request\)/);
  assert.match(readinessRoute, /verifyWhatsAppProvider\(\)/);
});

test("WhatsApp readiness performs read-only provider checks", () => {
  assert.match(readinessHelper, /display_phone_number,verified_name/);
  assert.match(readinessHelper, /message_templates/);
  assert.doesNotMatch(readinessHelper, /\/messages/);
  assert.doesNotMatch(readinessHelper, /method:\s*["']POST["']/);
});

test("both runtimes support optional WABA id and explicit demo flag", () => {
  assert.match(vercelEnv, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  assert.match(cloudflareEnv, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  assert.match(vercelEnv, /WHATSAPP_DEMO_ENABLED/);
  assert.match(cloudflareEnv, /WHATSAPP_DEMO_ENABLED/);
});
