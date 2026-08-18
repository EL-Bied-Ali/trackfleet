import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerPhone } from "./customer-contact";
import { parseAutomationStartAt } from "./notification-policy";
import { whatsappTemplateLanguage } from "./whatsapp-template";

const graphApiVersion = "v25.0";

type ProviderVerification = {
  configurationReady: boolean;
  providerVerified: boolean;
  templateVerified: boolean | null;
  templateName: string;
  templateLanguage: string;
  missing: string[];
  phoneNumber?: { id: string; displayPhoneNumber?: string; verifiedName?: string };
  error?: string;
};

function configuredValues() {
  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const businessAccountId = runtimeEnv.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? "";
  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim() ?? "";
  const templateLanguage = whatsappTemplateLanguage();
  const demoRecipient = normalizeCustomerPhone(runtimeEnv.WHATSAPP_DEMO_RECIPIENT ?? "") ?? "";
  const activationConfigured = Boolean(parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT));

  const providerMissing: string[] = [];
  if (!token) providerMissing.push("access_token");
  if (!phoneNumberId) providerMissing.push("phone_number_id");
  if (!templateName) providerMissing.push("template_name");

  const automationMissing = [...providerMissing];
  if (!activationConfigured) automationMissing.push("activation_start_at");

  return {
    token,
    phoneNumberId,
    businessAccountId,
    templateName,
    templateLanguage,
    demoRecipient,
    activationConfigured,
    providerMissing,
    automationMissing,
  };
}

export function getWhatsAppConfigurationReadiness() {
  const config = configuredValues();
  return {
    // Provider checks are intentionally independent from the automation
    // activation boundary, so Meta can be verified while sending is disabled.
    configurationReady: config.providerMissing.length === 0,
    providerReady: config.providerMissing.length === 0,
    automationReady: config.automationMissing.length === 0,
    demoReady: config.providerMissing.length === 0 && Boolean(config.demoRecipient),
    businessAccountConfigured: Boolean(config.businessAccountId),
    activationConfigured: config.activationConfigured,
    demoRecipientConfigured: Boolean(config.demoRecipient),
    templateName: config.templateName || null,
    templateLanguage: config.templateLanguage,
    missing: config.providerMissing,
    automationMissing: config.automationMissing,
  };
}

export async function verifyWhatsAppProvider(fetchImpl: typeof fetch = fetch): Promise<ProviderVerification> {
  const config = configuredValues();
  if (config.providerMissing.length > 0) {
    return {
      configurationReady: false,
      providerVerified: false,
      templateVerified: null,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      missing: config.providerMissing,
    };
  }

  const phoneResponse = await fetchImpl(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(config.phoneNumberId)}?fields=id,display_phone_number,verified_name`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!phoneResponse.ok) {
    return {
      configurationReady: true,
      providerVerified: false,
      templateVerified: null,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      missing: config.providerMissing,
      error: `phone_number_verification_failed:${phoneResponse.status}`,
    };
  }

  const phone = await phoneResponse.json() as { id?: string; display_phone_number?: string; verified_name?: string };
  let templateVerified: boolean | null = null;

  if (config.businessAccountId) {
    const templatesResponse = await fetchImpl(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(config.businessAccountId)}/message_templates?fields=name,status,language&limit=100`, {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!templatesResponse.ok) {
      return {
        configurationReady: true,
        providerVerified: true,
        templateVerified: false,
        templateName: config.templateName,
        templateLanguage: config.templateLanguage,
        missing: config.providerMissing,
        phoneNumber: { id: phone.id ?? config.phoneNumberId, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name },
        error: `template_verification_failed:${templatesResponse.status}`,
      };
    }
    const templates = await templatesResponse.json() as { data?: Array<{ name?: string; status?: string; language?: string }> };
    templateVerified = Boolean(templates.data?.some((template) =>
      template.name === config.templateName
      && template.status === "APPROVED"
      && template.language === config.templateLanguage
    ));
  }

  return {
    configurationReady: true,
    providerVerified: true,
    templateVerified,
    templateName: config.templateName,
    templateLanguage: config.templateLanguage,
    missing: config.providerMissing,
    phoneNumber: { id: phone.id ?? config.phoneNumberId, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name },
  };
}
