import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeCustomerPhone } from "./customer-contact";
import { parseAutomationStartAt } from "./notification-policy";

const graphApiVersion = "v25.0";

type ProviderVerification = {
  configurationReady: boolean;
  providerVerified: boolean;
  templateVerified: boolean | null;
  missing: string[];
  phoneNumber?: { id: string; displayPhoneNumber?: string; verifiedName?: string };
  error?: string;
};

function configuredValues() {
  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const businessAccountId = runtimeEnv.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? "";
  const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim() ?? "";
  const demoRecipient = normalizeCustomerPhone(runtimeEnv.WHATSAPP_DEMO_RECIPIENT ?? "") ?? "";
  const activationConfigured = Boolean(parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT));

  const missing: string[] = [];
  if (!token) missing.push("access_token");
  if (!phoneNumberId) missing.push("phone_number_id");
  if (!templateName) missing.push("template_name");
  if (!activationConfigured) missing.push("activation_start_at");

  return { token, phoneNumberId, businessAccountId, templateName, demoRecipient, activationConfigured, missing };
}

export function getWhatsAppConfigurationReadiness() {
  const config = configuredValues();
  return {
    configurationReady: config.missing.length === 0,
    demoReady: config.missing.filter((item) => item !== "activation_start_at").length === 0 && Boolean(config.demoRecipient),
    businessAccountConfigured: Boolean(config.businessAccountId),
    activationConfigured: config.activationConfigured,
    demoRecipientConfigured: Boolean(config.demoRecipient),
    missing: config.missing,
  };
}

export async function verifyWhatsAppProvider(fetchImpl: typeof fetch = fetch): Promise<ProviderVerification> {
  const config = configuredValues();
  if (config.missing.some((item) => item === "access_token" || item === "phone_number_id" || item === "template_name")) {
    return { configurationReady: false, providerVerified: false, templateVerified: null, missing: config.missing };
  }

  const phoneResponse = await fetchImpl(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(config.phoneNumberId)}?fields=id,display_phone_number,verified_name`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!phoneResponse.ok) {
    return {
      configurationReady: config.missing.length === 0,
      providerVerified: false,
      templateVerified: null,
      missing: config.missing,
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
        configurationReady: config.missing.length === 0,
        providerVerified: true,
        templateVerified: false,
        missing: config.missing,
        phoneNumber: { id: phone.id ?? config.phoneNumberId, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name },
        error: `template_verification_failed:${templatesResponse.status}`,
      };
    }
    const templates = await templatesResponse.json() as { data?: Array<{ name?: string; status?: string; language?: string }> };
    templateVerified = Boolean(templates.data?.some((template) => template.name === config.templateName && template.status === "APPROVED"));
  }

  return {
    configurationReady: config.missing.length === 0,
    providerVerified: true,
    templateVerified,
    missing: config.missing,
    phoneNumber: { id: phone.id ?? config.phoneNumberId, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name },
  };
}
