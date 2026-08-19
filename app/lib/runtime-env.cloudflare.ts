import { env } from "cloudflare:workers";

export type TrackFleetRuntimeEnv = {
  DB?: D1Database;
  SENDATRACK_ACCOUNT_ID?: string;
  SENDATRACK_USER?: string;
  SENDATRACK_PASSWORD?: string;
  SENDATRACK_API_URL?: string;
  TRACKFLEET_ENCRYPTION_KEY?: string;
  TRACKFLEET_TELEMETRY_RETENTION_DAYS?: string;
  TRACKFLEET_UNLOAD_GRACE_MINUTES?: string;
  CRON_SECRET?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  WHATSAPP_DEMO_RECIPIENT?: string;
  WHATSAPP_DEMO_ENABLED?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TEMPLATE_LANGUAGE?: string;
  WHATSAPP_AUTOMATION_ENABLED?: string;
  WHATSAPP_AUTOMATION_START_AT?: string;
};

export const runtimeEnv = env as unknown as TrackFleetRuntimeEnv;
export const runtimePlatform = "cloudflare" as const;
