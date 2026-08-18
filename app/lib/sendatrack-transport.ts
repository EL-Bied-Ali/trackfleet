import { runtimeEnv } from "trackfleet-runtime-env";

export const DEFAULT_SENDATRACK_API_URL = "http://backend2.sendatrack.com/sendatrack/public/api/";

export function configuredSendatrackApiUrl() {
  return runtimeEnv.SENDATRACK_API_URL?.trim() || DEFAULT_SENDATRACK_API_URL;
}

export function sendatrackTransportIsSecure() {
  try {
    return new URL(configuredSendatrackApiUrl()).protocol === "https:";
  } catch {
    return false;
  }
}
