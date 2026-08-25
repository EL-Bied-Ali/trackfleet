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
const snapshotMaxAttempts = 2;
const snapshotRetryDelayMs = 750;
// A wall-clock budget for the WHOLE snapshot call (every login/list request
// across every attempt and retry), not a per-fetch allowance. Each
// individual fetch previously got its own fresh 12s timeout regardless of
// how much time earlier calls in the same snapshot had already used --
// worst case (auth-retry within an attempt, times two outer attempts) could
// legitimately run past a minute when SENDATRACK responds slowly rather
// than failing fast, which is long enough for Cloudflare's own platform-
// level request cancellation to kill the whole Worker invocation first
// (observed live: "outcome": "canceled" with ~20s wall time, ~8ms CPU --
// not a CPU/resource-limit issue, a hung-upstream one). One shared signal
// means every fetch after this budget is exhausted fails fast instead of
// getting its own fresh allowance, so the function's own graceful
// "service_unavailable" return always wins that race.
const snapshotOverallTimeoutMs = 15_000;

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
  // Must include the password: this key gates whether login() trusts a
  // cached token without recontacting SENDATRACK. Keying on account+user
  // alone let any password succeed for up to 45 minutes after one real
  // login, because the password was never actually re-verified.
  const separator = String.fromCharCode(0);
  return `${auth.accountID.trim().toLowerCase()}${separator}${auth.user.trim().toLowerCase()}${separator}${auth.password}`;
}

const tokenCacheTtlSeconds = 45 * 60;

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type TokenCacheKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

function tokenCacheKv() {
  return (runtimeEnv as unknown as { SENDATRACK_TOKEN_CACHE?: TokenCacheKv }).SENDATRACK_TOKEN_CACHE ?? null;
}

async function kvCacheKey(key: string) {
  // The in-memory key embeds the raw password (see credentialKey above).
  // KV persists to disk and is listable, so it must never see that value
  // directly -- only its hash.
  return `sendatrack-token:${await sha256Hex(key)}`;
}

// cachedTokens is a plain in-memory Map, which only helps within a single
// Worker isolate: Cloudflare Workers are stateless and isolates are
// frequently recycled, so without KV backing this almost never survives
// between requests -- every poll ends up re-authenticating with SENDATRACK
// instead of reusing a token for the intended 45-minute window. KV is
// optional (undefined on Vercel/local dev without the binding) so the
// in-memory map remains a correct, if isolate-local, fallback there.
async function readCachedToken(key: string) {
  const cached = cachedTokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const kv = tokenCacheKv();
  if (!kv) return null;
  try {
    const stored = await kv.get(await kvCacheKey(key));
    if (!stored) return null;
    cachedTokens.set(key, { value: stored, expiresAt: Date.now() + tokenCacheTtlSeconds * 1000 });
    return stored;
  } catch (error) {
    console.error("[trackfleet:sendatrack] token cache read failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

async function writeCachedToken(key: string, token: string) {
  cachedTokens.set(key, { value: token, expiresAt: Date.now() + tokenCacheTtlSeconds * 1000 });
  const kv = tokenCacheKv();
  if (!kv) return;
  try {
    await kv.put(await kvCacheKey(key), token, { expirationTtl: tokenCacheTtlSeconds });
  } catch (error) {
    console.error("[trackfleet:sendatrack] token cache write failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

async function deleteCachedToken(key: string) {
  cachedTokens.delete(key);
  const kv = tokenCacheKv();
  if (!kv) return;
  try {
    await kv.delete(await kvCacheKey(key));
  } catch (error) {
    console.error("[trackfleet:sendatrack] token cache delete failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

type SendatrackFetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type RelayConfig = { url: string; secret: string };

const relayUrlCacheKey = "sendatrack-relay:url";

// The relay (see relay/README.md) runs on a device with a residential/mobile
// IP and self-registers its current address here via POST
// /api/sendatrack/relay, since a free Cloudflare quick tunnel's URL changes
// every time the relay process restarts. SENDATRACK_RELAY_URL is an optional
// static override for a future stable (named-tunnel) address -- when unset,
// the most recently registered dynamic URL is used instead.
export async function setRelayUrl(url: string) {
  const kv = tokenCacheKv();
  if (!kv) throw new Error("relay_storage_unavailable");
  await kv.put(relayUrlCacheKey, url, { expirationTtl: 60 * 60 * 24 });
}

async function dynamicRelayUrl(): Promise<string | null> {
  const kv = tokenCacheKv();
  if (!kv) return null;
  try {
    return await kv.get(relayUrlCacheKey);
  } catch {
    return null;
  }
}

async function relayConfig(): Promise<RelayConfig | null> {
  const secret = runtimeEnv.SENDATRACK_RELAY_SECRET?.trim();
  if (!secret) return null;
  const url = runtimeEnv.SENDATRACK_RELAY_URL?.trim() || await dynamicRelayUrl();
  if (!url) return null;
  return { url, secret };
}

// SENDATRACK's own network rejects requests from Cloudflare's (and most
// cloud/datacenter) IP ranges -- observed as 408s from Cloudflare's edge and
// a fast 406 "Account not found" from another datacenter network, while the
// same credentials work fine from residential/mobile connections. When a
// relay is configured, route the actual SENDATRACK call through it instead
// of calling backend2.sendatrack.com directly from the Worker.
async function relayFetch(relay: RelayConfig, targetUrl: string, init: SendatrackFetchInit) {
  const response = await fetch(relay.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${relay.secret}` },
    body: JSON.stringify({
      url: targetUrl,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body ?? null,
    }),
    signal: init.signal,
  });
  if (!response.ok) throw new Error("service_unavailable");
  const payload = await response.json() as { status: number; headers: Record<string, string>; body: string };
  return new Response(payload.body, { status: payload.status, headers: payload.headers });
}

async function sendatrackFetch(targetUrl: string, init: SendatrackFetchInit) {
  const relay = await relayConfig();
  if (relay) return relayFetch(relay, targetUrl, init);
  return fetch(targetUrl, init);
}

function providerUnavailableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function authenticationRejectedStatus(status: number) {
  return status === 401 || status === 403;
}

async function authenticationRejectedResponse(response: Response) {
  if (authenticationRejectedStatus(response.status)) return true;
  if (response.status !== 406) return false;
  try {
    const payload = asRecord(await response.json());
    return stringFrom(payload?.message).toLowerCase() === "account not found";
  } catch {
    return false;
  }
}

async function login(auth: SendatrackCredentials, signal: AbortSignal) {
  requireAllowedTransport();
  const key = credentialKey(auth);
  const cachedToken = await readCachedToken(key);
  if (cachedToken) return cachedToken;
  if (!auth.accountID || !auth.user || !auth.password) return null;
  const response = await sendatrackFetch(apiUrl("login"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...auth, machin: "trackfleet-connector", remember: true, force: false }),
    signal,
  });
  if (!response.ok) {
    console.error("[trackfleet:sendatrack] login rejected", {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      retryAfter: response.headers.get("retry-after"),
    });
    if (providerUnavailableStatus(response.status)) throw new Error("service_unavailable");
    if (await authenticationRejectedResponse(response)) throw new Error("authentication_failed");
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
  await writeCachedToken(key, token);
  return token;
}

async function requestFleetPayload(token: string, auth: SendatrackCredentials, signal: AbortSignal) {
  requireAllowedTransport();
  const response = await sendatrackFetch(apiUrl("list?"), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal,
  });
  if (response.status === 401) {
    await deleteCachedToken(credentialKey(auth));
    throw new Error("authentication_failed");
  }
  if (!response.ok) throw new Error("service_unavailable");
  return await response.json() as unknown;
}

async function requestFleet(token: string, auth: SendatrackCredentials, signal: AbortSignal) {
  const payload = await requestFleetPayload(token, auth, signal);
  const { vehicles, diagnostics } = normalizeSendatrackFleet(payload);
  console.info("[trackfleet:sendatrack] fleet normalized", diagnostics);
  return vehicles;
}

function retryableSnapshotError(code: string) {
  return code === "authentication_failed" || code === "service_unavailable" || code === "unexpected_response";
}

async function waitBeforeSnapshotRetry() {
  await new Promise((resolve) => setTimeout(resolve, snapshotRetryDelayMs));
}

export function isSendatrackConfigured() {
  const auth = environmentCredentials();
  return Boolean(auth.accountID && auth.user && auth.password);
}

export async function getSendatrackLegacyHistoryIdentities(): Promise<SendatrackLegacyHistoryIdentity[]> {
  const auth = environmentCredentials();
  if (!auth.accountID || !auth.user || !auth.password) return [];
  const signal = AbortSignal.timeout(snapshotOverallTimeoutMs);
  const token = await login(auth, signal);
  if (!token) return [];
  const payload = await requestFleetPayload(token, auth, signal);
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

  // One deadline for every login/list call this function makes, across
  // every attempt and every within-attempt auth retry below -- see
  // snapshotOverallTimeoutMs for why a per-fetch timeout alone isn't enough.
  const signal = AbortSignal.timeout(snapshotOverallTimeoutMs);
  for (let attempt = 1; attempt <= snapshotMaxAttempts; attempt += 1) {
    try {
      let token = await login(auth, signal);
      if (!token) return { configured: false, connected: false, vehicles: [], error: "not_configured" };
      try {
        const vehicles = await requestFleet(token, auth, signal);
        return { configured: true, connected: true, vehicles };
      } catch (error) {
        if (error instanceof Error && error.message === "authentication_failed") {
          token = await login(auth, signal);
          if (token) return { configured: true, connected: true, vehicles: await requestFleet(token, auth, signal) };
        }
        throw error;
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "service_unavailable";
      if (attempt < snapshotMaxAttempts && retryableSnapshotError(code)) {
        await deleteCachedToken(credentialKey(auth));
        console.warn("[trackfleet:sendatrack] snapshot retry", { code, attempt });
        await waitBeforeSnapshotRetry();
        continue;
      }
      console.error("[trackfleet:sendatrack] snapshot failed", { code, attempts: attempt });
      return {
        configured: true,
        connected: false,
        vehicles: [],
        error: code === "authentication_failed" ? "authentication_failed" : code === "unexpected_response" ? "unexpected_response" : "service_unavailable",
      };
    }
  }

  return { configured: true, connected: false, vehicles: [], error: "service_unavailable" };
}
