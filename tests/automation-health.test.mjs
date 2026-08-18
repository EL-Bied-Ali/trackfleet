import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { automationMissingRequirements } from "../app/lib/automation-health.ts";

const healthRoute = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
const persistentStorage = { mode: "postgres", persistent: true, connected: true, error: null };

test("health explains why production automation is not ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: { mode: "memory", persistent: false, connected: true, error: null },
    sendatrackConfigured: true,
    sessionEncryptionConfigured: true,
    tickProtected: false,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["persistent_storage", "cron_secret"]);
});

test("dedicated session encryption key is required for production readiness", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sessionEncryptionConfigured: false,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["session_encryption_key"]);
});

test("disabled WhatsApp does not block GPS automation readiness", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), []);
});

test("enabled WhatsApp requires provider and activation boundary", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: true,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["whatsapp_provider", "whatsapp_activation_start"]);
});

test("health provider readiness includes explicit security and Meta requirements", () => {
  assert.match(healthRoute, /TRACKFLEET_ENCRYPTION_KEY/);
  assert.match(healthRoute, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(healthRoute, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_LANGUAGE/);
});
