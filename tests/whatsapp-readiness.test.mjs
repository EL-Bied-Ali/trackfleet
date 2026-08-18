import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [demoRoute, readinessRoute, readinessHelper, templateHelper, automation, vercelEnv, cloudflareEnv] = await Promise.all([
  readFile(new URL("../app/api/whatsapp/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/whatsapp/readiness/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-readiness.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-template.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8"),
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

test("unexpected readiness failures are logged but sanitized for callers", () => {
  assert.match(readinessRoute, /console\.error\("\[trackfleet:whatsapp\] readiness verification failed", \{ message \}\)/);
  assert.match(readinessRoute, /error: "provider_verification_failed"/);
  assert.doesNotMatch(readinessRoute, /error: error instanceof Error \? error\.message/);
});

test("WhatsApp readiness performs read-only provider checks", () => {
  assert.match(readinessHelper, /display_phone_number,verified_name/);
  assert.match(readinessHelper, /message_templates/);
  assert.match(readinessHelper, /fields=name,status,language,components/);
  assert.doesNotMatch(readinessHelper, /\/messages/);
  assert.doesNotMatch(readinessHelper, /method:\s*["']POST["']/);
});

test("provider readiness can be verified before automation activation", () => {
  assert.match(readinessHelper, /providerMissing/);
  assert.match(readinessHelper, /automationMissing/);
  assert.match(readinessHelper, /configurationReady: config\.providerMissing\.length === 0/);
  assert.match(readinessHelper, /automationReady: config\.automationMissing\.length === 0/);
  assert.match(readinessHelper, /automationMissing\.push\(["']activation_start_at["']\)/);
  assert.doesNotMatch(readinessHelper, /providerMissing\.push\(["']activation_start_at["']\)/);
});

test("production readiness requires an explicit template language", () => {
  assert.match(readinessHelper, /configuredTemplateLanguage/);
  assert.match(readinessHelper, /providerMissing\.push\(["']template_language["']\)/);
  assert.match(automation, /WHATSAPP_TEMPLATE_LANGUAGE\?\.trim\(\)/);
  assert.match(automation, /!templateName \|\| !templateLanguage \|\| !message/);
});

test("template language is shared by demo, automation, preview readiness and both runtimes", () => {
  assert.match(vercelEnv, /WHATSAPP_TEMPLATE_LANGUAGE/);
  assert.match(cloudflareEnv, /WHATSAPP_TEMPLATE_LANGUAGE/);
  assert.match(templateHelper, /WHATSAPP_TEMPLATE_LANGUAGE\?\.trim\(\)/);
  assert.match(automation, /whatsappTemplateLanguage\(\)/);
  assert.match(demoRoute, /whatsappTemplateLanguage\(\)/);
  assert.match(readinessHelper, /templateLanguage:\s*config\.templateLanguage/);
});

test("provider verification finds the configured template language before checking approval", () => {
  assert.match(readinessHelper, /candidate\.name === config\.templateName/);
  assert.match(readinessHelper, /candidate\.language === config\.templateLanguage/);
  assert.match(readinessHelper, /template\.status === ["']APPROVED["']/);
  assert.match(readinessHelper, /templateApproved/);
});

test("provider verification enforces the three-body-parameter TrackFleet template contract", () => {
  assert.match(readinessHelper, /expectedTemplateBodyParameters = 3/);
  assert.match(readinessHelper, /component\.type === ["']BODY["']/);
  assert.match(readinessHelper, /body\.matchAll/);
  assert.match(readinessHelper, /templateApproved && templateBodyParameters === expectedTemplateBodyParameters/);
  assert.match(readinessHelper, /expectedTemplateBodyParameters/);
});

test("Meta calls have bounded request timeouts", () => {
  assert.match(readinessHelper, /metaRequestTimeoutMs = 10_000/);
  assert.match(readinessHelper, /AbortSignal\.timeout\(metaRequestTimeoutMs\)/);
  assert.match(automation, /metaRequestTimeoutMs = 10_000/);
  assert.match(automation, /AbortSignal\.timeout\(metaRequestTimeoutMs\)/);
});

test("both runtimes support optional WABA id and explicit demo flag", () => {
  assert.match(vercelEnv, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  assert.match(cloudflareEnv, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  assert.match(vercelEnv, /WHATSAPP_DEMO_ENABLED/);
  assert.match(cloudflareEnv, /WHATSAPP_DEMO_ENABLED/);
});
