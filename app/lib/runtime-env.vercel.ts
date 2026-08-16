export type TrackFleetRuntimeEnv = {
  DB?: undefined;
  SENDATRACK_ACCOUNT_ID?: string;
  SENDATRACK_USER?: string;
  SENDATRACK_PASSWORD?: string;
  SENDATRACK_API_URL?: string;
  TRACKFLEET_ENCRYPTION_KEY?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_DEMO_RECIPIENT?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
};

export const runtimeEnv = process.env as TrackFleetRuntimeEnv;
export const runtimePlatform = "vercel" as const;
