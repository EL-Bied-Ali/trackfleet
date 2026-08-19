import { runtimeEnv } from "trackfleet-runtime-env";

export const DEFAULT_SENDATRACK_API_URL = "http://backend2.sendatrack.com/sendatrack/public/api/";
const EXPECTED_SENDATRACK_HOST = "backend2.sendatrack.com";

export function configuredSendatrackApiUrl() {
  return runtimeEnv.SENDATRACK_API_URL?.trim() || DEFAULT_SENDATRACK_API_URL;
}

export function sendatrackTransportIsSecure() {
  try {
    const target = new URL(configuredSendatrackApiUrl());
    return target.protocol === "https:" && target.hostname === EXPECTED_SENDATRACK_HOST;
  } catch {
    return false;
  }
}

export function insecureSendatrackTransportExplicitlyAllowed() {
  return runtimeEnv.TRACKFLEET_ALLOW_INSECURE_SENDATRACK === "true";
}

export function sendatrackTransportIsAllowed() {
  return sendatrackTransportIsSecure() || insecureSendatrackTransportExplicitlyAllowed();
}
