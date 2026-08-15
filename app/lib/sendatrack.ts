import { env } from "cloudflare:workers";

type SendatrackEnv = {
  SENDATRACK_ACCOUNT_ID?: string;
  SENDATRACK_USER?: string;
  SENDATRACK_PASSWORD?: string;
  SENDATRACK_API_URL?: string;
};

export type SendatrackCredentials = {
  accountID: string;
  user: string;
  password: string;
};

export type SendatrackVehicle = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number | null;
  address: string;
  updatedAt: number;
};

export type SendatrackSnapshot = {
  configured: boolean;
  connected: boolean;
  vehicles: SendatrackVehicle[];
  error?: "not_configured" | "authentication_failed" | "service_unavailable" | "unexpected_response";
};

const runtimeEnv = env as unknown as SendatrackEnv;
const defaultApiUrl = "http://backend2.sendatrack.com/sendatrack/public/api/";
const cachedTokens = new Map<string, { value: string; expiresAt: number }>();

function environmentCredentials(): SendatrackCredentials {
  return {
    accountID: runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "",
    user: runtimeEnv.SENDATRACK_USER?.trim() ?? "",
    password: runtimeEnv.SENDATRACK_PASSWORD ?? "",
  };
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

async function login(auth: SendatrackCredentials) {
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
  if (!response.ok) throw new Error("authentication_failed");
  const payload = await response.json() as unknown;
  const token = findToken(payload);
  if (!token) throw new Error("authentication_failed");
  cachedTokens.set(key, { value: token, expiresAt: Date.now() + 45 * 60 * 1000 });
  return token;
}

function numberFrom(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function timestampFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value && Number.isNaN(Number(value))) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    const numeric = numberFrom(value);
    if (numeric !== null && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.now();
}

function candidateArrays(value: unknown, depth = 0): Array<{ items: unknown[]; depth: number }> {
  if (depth > 4) return [];
  if (Array.isArray(value)) return [{ items: value, depth }, ...value.flatMap((item) => candidateArrays(item, depth + 1))];
  const record = asRecord(value);
  return record ? Object.values(record).flatMap((item) => candidateArrays(item, depth + 1)) : [];
}

function normalizeVehicle(value: unknown): SendatrackVehicle | null {
  const record = asRecord(value);
  if (!record) return null;
  const events = Array.isArray(record.EventData) ? record.EventData : Array.isArray(record.events) ? record.events : [];
  const event = asRecord(events.at(-1)) ?? asRecord(record.lastEvent) ?? asRecord(record.event) ?? record;
  const latitude = numberFrom(record.lastValidLatitude, record.latitude, record.lat, record.GPSPoint_lat, event.GPSPoint_lat, event.latitude, event.lat);
  const longitude = numberFrom(record.lastValidLongitude, record.longitude, record.lng, record.lon, record.GPSPoint_lon, event.GPSPoint_lon, event.longitude, event.lng, event.lon);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const id = stringFrom(record.id, record.id_Vehicle, record.vehicleId, record.DeviceCode, record.Device, event.DeviceCode);
  const name = stringFrom(record.name, record.vehicleName, record.Device_desc, record.description, record.Device, id);
  if (!id || !name) return null;
  return {
    id,
    name,
    latitude,
    longitude,
    speed: numberFrom(record.speed, record.Speed, event.Speed, event.speed) ?? 0,
    heading: numberFrom(record.heading, record.Heading, event.Heading, event.heading),
    address: stringFrom(record.address, record.Address, event.Address, event.address),
    updatedAt: timestampFrom(record.timestamp, record.Timestamp, record.lastUpdate, event.Timestamp, event.timestamp),
  };
}

function normalizeFleet(payload: unknown) {
  const groups = candidateArrays(payload)
    .map(({ items, depth }) => ({ depth, vehicles: items.map(normalizeVehicle).filter((item): item is SendatrackVehicle => Boolean(item)) }))
    .filter((group) => group.vehicles.length > 0);
  const vehicles = groups.flatMap((group) => group.vehicles);
  const newestByVehicle = new Map<string, SendatrackVehicle>();
  for (const vehicle of vehicles) {
    const vehicleKey = vehicle.name.toLowerCase().replace(/[^a-z0-9]/g, "") || vehicle.id;
    const existing = newestByVehicle.get(vehicleKey);
    if (!existing || vehicle.updatedAt >= existing.updatedAt) newestByVehicle.set(vehicleKey, vehicle);
  }
  return [...newestByVehicle.values()];
}

async function requestFleet(token: string, auth: SendatrackCredentials) {
  const response = await fetch(apiUrl("list?"), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401) {
    cachedTokens.delete(credentialKey(auth));
    throw new Error("authentication_failed");
  }
  if (!response.ok) throw new Error("service_unavailable");
  return normalizeFleet(await response.json() as unknown);
}

export function isSendatrackConfigured() {
  const auth = environmentCredentials();
  return Boolean(auth.accountID && auth.user && auth.password);
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
    return {
      configured: true,
      connected: false,
      vehicles: [],
      error: code === "authentication_failed" ? "authentication_failed" : code === "unexpected_response" ? "unexpected_response" : "service_unavailable",
    };
  }
}
