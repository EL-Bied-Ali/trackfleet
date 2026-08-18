import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { automationMissingRequirements } from "../app/lib/automation-health.ts";
import { decodeSessionEncryptionKey, sessionEncryptionKeyConfigured } from "../app/lib/session-encryption-key.ts";

const healthRoute = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
const persistentStorage = { mode: "postgres", persistent: true, connected: true, error: null };

test("health explains why production automation is not ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: { mode: "memory", persistent: false, connected: true, error: null },
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
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
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: false,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["session_encryption_key"]);
});

test("insecure SENDATRACK transport blocks a production-ready status", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: false,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: false,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["sendatrack_https"]);
});

test("session encryption readiness accepts only a 32-byte Base64 key", () => {
  const valid = Buffer.alloc(32, 7).toString("base64");
  const validUrl = valid.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  assert.equal(sessionEncryptionKeyConfigured(valid), true);
  assert.equal(sessionEncryptionKeyConfigured(validUrl), true);
  assert.equal(decodeSessionEncryptionKey(valid)?.byteLength, 32);
  assert.equal(sessionEncryptionKeyConfigured(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(sessionEncryptionKeyConfigured(Buffer.alloc(33, 7).toString("base64")), false);
  assert.equal(sessionEncryptionKeyConfigured("not base64 !!!"), false);
  assert.equal(sessionEncryptionKeyConfigured(""), false);
  assert.equal(sessionEncryptionKeyConfigured(undefined), false);
});

test("disabled WhatsApp does not block GPS automation readiness when core security is ready", () => {
  assert.deepEqual(automationMissingRequirements({
    storage: persistentStorage,
    sendatrackConfigured: true,
    sendatrackTransportSecure: true,
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
    sendatrackTransportSecure: true,
    sessionEncryptionConfigured: true,
    tickProtected: true,
    whatsappEnabled: true,
    whatsappProviderConfigured: false,
    whatsappActivationConfigured: false,
  }), ["whatsapp_provider", "whatsapp_activation_start"]);
});

test("health provider readiness includes explicit security and Meta requirements", () => {
  assert.match(healthRoute, /sessionEncryptionKeyConfigured/);
  assert.match(healthRoute, /TRACKFLEET_ENCRYPTION_KEY/);
  assert.match(healthRoute, /sendatrackTransportIsSecure/);
  assert.match(healthRoute, /sendatrackTransportSecure/);
  assert.match(healthRoute, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(healthRoute, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(healthRoute, /WHATSAPP_TEMPLATE_LANGUAGE/);
});
