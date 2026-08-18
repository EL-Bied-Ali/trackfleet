import { runtimeEnv } from "trackfleet-runtime-env";

const defaultTemplateLanguage = "en_US";

export function whatsappTemplateLanguage() {
  return runtimeEnv.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || defaultTemplateLanguage;
}
