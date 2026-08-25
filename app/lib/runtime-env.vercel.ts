import { normalizeEnvValue } from "./env-value";

export type TrackFleetRuntimeEnv = {
  DB?: undefined;
  SENDATRACK_TOKEN_CACHE?: undefined;
  DATABASE_URL?: string;
  SENDATRACK_ACCOUNT_ID?: string;
  SENDATRACK_USER?: string;
  SENDATRACK_PASSWORD?: string;
  SENDATRACK_API_URL?: string;
  SENDATRACK_RELAY_URL?: string;
  SENDATRACK_RELAY_SECRET?: string;
  TRACKFLEET_ALLOW_INSECURE_SENDATRACK?: string;
  TRACKFLEET_ENCRYPTION_KEY?: string;
  TRACKFLEET_TELEMETRY_RETENTION_DAYS?: string;
  TRACKFLEET_UNLOAD_GRACE_MINUTES?: string;
  TRACKFLEET_D1_READ_FAILOVER?: string;
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
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_PRICE_ID_STANDARD_MONTHLY?: string;
  PADDLE_PRICE_ID_STANDARD_YEARLY?: string;
  PADDLE_PRICE_ID_PRO_MONTHLY?: string;
  PADDLE_PRICE_ID_PRO_YEARLY?: string;
  PADDLE_ENVIRONMENT?: string;
  ADMIN_EMAILS?: string;
};

const rawRuntimeEnv = process.env as TrackFleetRuntimeEnv;

export const runtimeEnv = new Proxy(rawRuntimeEnv, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    return typeof value === "string" ? normalizeEnvValue(value) : value;
  },
});

export const runtimePlatform = "vercel" as const;
