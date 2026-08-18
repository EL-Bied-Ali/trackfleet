import { runtimeEnv } from "trackfleet-runtime-env";
import { getCompanySession } from "../../../lib/company-auth";
import { getStorageHealth } from "../../../lib/storage-health";
import { getWhatsAppConfigurationReadiness, verifyWhatsAppProvider } from "../../../lib/whatsapp-readiness";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);

  const [storage, configuration] = await Promise.all([
    getStorageHealth(),
    Promise.resolve(getWhatsAppConfigurationReadiness()),
  ]);

  let provider: Awaited<ReturnType<typeof verifyWhatsAppProvider>> | null = null;
  let providerError: string | null = null;

  if (configuration.providerReady) {
    try {
      provider = await verifyWhatsAppProvider();
    } catch (error) {
      providerError = error instanceof Error ? error.message : "provider_verification_failed";
    }
  }

  const checks = {
    persistentStorage: storage.persistent && storage.connected,
    schedulerProtected: Boolean(runtimeEnv.CRON_SECRET?.trim()),
    providerConfigured: configuration.providerReady,
    businessAccountConfigured: configuration.businessAccountConfigured,
    phoneNumberVerified: provider?.providerVerified === true,
    templateApproved: provider?.templateVerified === true,
    templateContractMatches: provider?.templateVerified === true
      && provider.templateBodyParameters === provider.expectedTemplateBodyParameters,
  };

  const readyToEnable = Object.values(checks).every(Boolean);
  const automationEnabled = runtimeEnv.WHATSAPP_AUTOMATION_ENABLED === "true";
  const readyToRun = readyToEnable && configuration.activationConfigured && automationEnabled;

  let nextAction = "ready";
  if (!checks.persistentStorage) nextAction = "configure_persistent_storage";
  else if (!checks.schedulerProtected) nextAction = "configure_cron_secret";
  else if (!checks.providerConfigured) nextAction = "configure_whatsapp_provider";
  else if (!checks.businessAccountConfigured) nextAction = "configure_whatsapp_business_account";
  else if (!checks.phoneNumberVerified) nextAction = "verify_whatsapp_phone_number";
  else if (!checks.templateApproved) nextAction = "wait_for_approved_template";
  else if (!checks.templateContractMatches) nextAction = "fix_template_body_parameters";
  else if (!configuration.activationConfigured) nextAction = "set_automation_start_at";
  else if (!automationEnabled) nextAction = "enable_automation";

  return json({
    ok: providerError === null,
    readyToEnable,
    readyToRun,
    nextAction,
    checks,
    automation: {
      enabled: automationEnabled,
      activationConfigured: configuration.activationConfigured,
    },
    template: {
      name: configuration.templateName,
      language: configuration.templateLanguage,
      expectedBodyParameters: configuration.expectedTemplateBodyParameters,
      observedBodyParameters: provider?.templateBodyParameters ?? null,
    },
    provider: provider ? {
      verified: provider.providerVerified,
      templateVerified: provider.templateVerified,
      phoneNumber: provider.phoneNumber ?? null,
      error: provider.error ?? null,
    } : null,
    providerError,
    storage: {
      mode: storage.mode,
      persistent: storage.persistent,
      connected: storage.connected,
      error: storage.error,
    },
  }, providerError ? 502 : 200);
}
