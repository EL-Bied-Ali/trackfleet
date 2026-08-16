import assert from "node:assert/strict";
import test from "node:test";
import { automationMissingRequirements } from "../app/lib/automation-health.ts";

const persistentStorage = { mode: "postgres", persistent: true, connected: true, error: null };

test("health explains why production automation is not ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: { mode: "memory", persistent: false, connected: true, error: null },
    sendatrackConfigured: true,
    tickProtected: false,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["persistent_storage", "cron_secret"]);
});

test("disabled WhatsApp does not block GPS automation readiness", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
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
    tickProtected: true,
    whatsappEnabled: true,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["whatsapp_provider", "whatsapp_activation_start"]);
});
