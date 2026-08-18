import type { StorageHealth } from "./storage-health.ts";

export type AutomationHealthInput = {
  storage: StorageHealth;
  sendatrackConfigured: boolean;
  sessionEncryptionConfigured: boolean;
  tickProtected: boolean;
  whatsappEnabled: boolean;
  whatsappProviderConfigured: boolean;
  whatsappActivationConfigured: boolean;
};

export function automationMissingRequirements(input: AutomationHealthInput) {
  const missing: string[] = [];
  if (!input.storage.persistent) missing.push("persistent_storage");
  if (!input.storage.connected) missing.push("storage_connection");
  if (!input.sendatrackConfigured) missing.push("sendatrack_credentials");
  if (!input.sessionEncryptionConfigured) missing.push("session_encryption_key");
  if (!input.tickProtected) missing.push("cron_secret");
  if (input.whatsappEnabled && !input.whatsappProviderConfigured) missing.push("whatsapp_provider");
  if (input.whatsappEnabled && !input.whatsappActivationConfigured) missing.push("whatsapp_activation_start");
  return missing;
}
