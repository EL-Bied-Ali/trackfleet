import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeSendatrackFleet, type SendatrackVehicle } from "./sendatrack-normalize";
import { sendatrackTransportIsAllowed } from "./sendatrack-transport";

export type SendatrackCredentials = {
  accountID: string;
  user: string;
  password: string;
};

export type { SendatrackVehicle } from "./sendatrack-normalize";

export type SendatrackSnapshot = {
  configured: boolean;
  connected: boolean;
  vehicles: SendatrackVehicle[];
  error?: "not_configured" | "authentication_failed" | "service_unavailable" | "unexpected_response";
};

export type SendatrackLegacyHistoryIdentity = {
  accountId: string;
  userId: string;
  password: string;
  deviceId: string;
  accountSource: "account_desc" | "account" | "configured";
};

const defaultApiUrl = "http://backend2.sendatrack.com/sendatrack/public/api/";
const cachedTokens = new Map<string, { value: string; expiresAt: number }>();

function environmentCredentials(): SendatrackCredentials {
  return {
    accountID: runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "",
    user: runtimeEnv.SENDATRACK_USER?.trim() ?? "",
    password: runtimeEnv.SENDATRACK_PASSWORD ?? "",
  };
}

function requireAllowedTransport() {
  if (!sendatrackTransportIsAllowed()) {
    console.error("[trackfleet:sendatrack] blocked insecure provider transport without explicit override");
    throw new Error("service_unavailable");
  }
}

function apiUrl(path: string) {
  const configuredBase = runtimeEnv.SENDATRACK_API_URL?.trim() || defaultApiUrl;
  const base = new URL(configuredBase);
  if (base.hostname !== "backend2.sendatrack.com") throw new Error("Unexpected SENDATRACK API host");
  const normalizedBase = `${base.toString().replace(/\/$/, "")}/`;
  return new URL(path, normalizedBase).toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function findStringByKey(value: unknown, key: string, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, key, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = asRecord(value);
  if (!record) return "";
  const direct = stringFrom(record[key]);
  if (direct) return direct;
  for (const nested of Object.values(record)) {
    const found = findStringByKey(nested, key, depth + 1);
    if (found) return found;
  }
  return "";
}

function findToken(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    const bearer = value.match(/Bearer\s+([^\s]+)/i)?.[1];
    if (bearer) return bearer;
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["token", "access_token", "accessToken", "jwt", "JWT"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 20) return candidate.replace(/^Bearer\s+/i, "");
  }
  for (const candidate of Object.values(record)) {
    const token = findToken(candidate, depth + 1);
    if (token) return token;
  }
  return null;
}

function credentialKey(auth: SendatrackCredentials) {
  return `${auth.accountID.trim().toLowerCase()}\u0000${auth.user.trim().toLowerCase()}`;
}

function providerUnavailableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function authenticationRejectedStatus(status: number) {
  return status === 401 || status === 403;
}

async function login(auth: SendatrackCredentials) {
  requireAllowedTransport();
  const key = credentialKey(auth);
  const cachedToken = cachedTokens.get(key);
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!auth.accountID || !auth.user || !auth.password) return null;
  const response = await fetch(apiUrl("login"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...auth, machin: "trackfleet-connector", remember: true, force: false }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    console.error("[trackfleet:sendatrack] login rejected", {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      retryAfter: response.headers.get("retry-after"),
    });
    if (providerUnavailableStatus(response.status)) throw new Error("service_unavailable");
    if (authenticationRejectedStatus(response.status)) throw new Error("authentication_failed");
    throw new Error("unexpected_response");
  }
  const payload = await response.json() as unknown;
  const token = findToken(payload);
  if (!token) {
    console.error("[trackfleet:sendatrack] login response missing token", {
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
    throw new Error("unexpected_response");
  }
  cachedTokens.set(key, { value: token, expiresAt: Date.now() + 45 * 60 * 1000 });
  return token;
}

async function requestFleetPayload(token: string, auth: SendatrackCredentials) {
  requireAllowedTransport();
  const response = await fetch(apiUrl("list?"), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401) {
    cachedTokens.delete(credentialKey(auth));
    throw new Error("authentication_failed");
  }
  if (!response.ok) throw new Error("service_unavailable");
  return await response.json() as unknown;
}

async function requestFleet(token: string, auth: SendatrackCredentials) {
  const payload = await requestFleetPayload(token, auth);
  const { vehicles, diagnostics } = normalizeSendatrackFleet(payload);
  console.info("[trackfleet:sendatrack] fleet normalized", diagnostics);
  return vehicles;
}

export function isSendatrackConfigured() {
  const auth = environmentCredentials();
  return Boolean(auth.accountID && auth.user && auth.password);
}

export async function getSendatrackLegacyHistoryIdentities(): Promise<SendatrackLegacyHistoryIdentity[]> {
  const auth = environmentCredentials();
  if (!auth.accountID || !auth.user || !auth.password) return [];
  const token = await login(auth);
  if (!token) return [];
  const payload = await requestFleetPayload(token, auth);
  const { vehicles, diagnostics } = normalizeSendatrackFleet(payload);
  console.info("[trackfleet:sendatrack] fleet normalized", diagnostics);
  const vehicle = vehicles[0];
  if (!vehicle?.providerDeviceId) return [];

  // OpenGTS uses the account key (not its human-readable description) for `a=`.
  // Keep discovery bounded to the three values already present in the authenticated
  // SENDATRACK context. If the insecure override is enabled, the provider request is knowingly HTTP.
  const candidates: SendatrackLegacyHistoryIdentity[] = [];
  const seen = new Set<string>();
  const add = (accountId: string, accountSource: SendatrackLegacyHistoryIdentity["accountSource"]) => {
    const normalized = accountId.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ accountId: normalized, userId: auth.user, password: auth.password, deviceId: vehicle.providerDeviceId, accountSource });
  };

  add(vehicle.providerAccountId, "account");
  add(auth.accountID, "configured");
  add(findStringByKey(payload, "Account_desc"), "account_desc");
  return candidates;
}

export async function getSendatrackLegacyHistoryIdentity(): Promise<SendatrackLegacyHistoryIdentity | null> {
  return (await getSendatrackLegacyHistoryIdentities())[0] ?? null;
}

export async function getSendatrackSnapshot(providedCredentials?: SendatrackCredentials): Promise<SendatrackSnapshot> {
  const auth = providedCredentials ?? environmentCredentials();
  if (!auth.accountID || !auth.user || !auth.password) return { configured: false, connected: false, vehicles: [], error: "not_configured" };
  try {
    let token = await login(auth);
    if (!token) return { configured: false, connected: false, vehicles: [], error: "not_configured" };
    try {
      const vehicles = await requestFleet(token, auth);
      return { configured: true, connected: true, vehicles };
    } catch (error) {
      if (error instanceof Error && error.message === "authentication_failed") {
        token = await login(auth);
        if (token) return { configured: true, connected: true, vehicles: await requestFleet(token, auth) };
      }
      throw error;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "service_unavailable";
    console.error("[trackfleet:sendatrack] snapshot failed", { code });
    return {
      configured: true,
      connected: false,
      vehicles: [],
      error: code === "authentication_failed" ? "authentication_failed" : code === "unexpected_response" ? "unexpected_response" : "service_unavailable",
    };
  }
}
