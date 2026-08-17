import { runtimeEnv } from "trackfleet-runtime-env";

const base = "http://backend2.sendatrack.com/sendatrack/public/api/";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function findToken(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const bearer = value.match(/Bearer\s+([^\s]+)/i)?.[1];
    if (bearer) return bearer;
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
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

function findFirstDeviceRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        if ("Device" in record || "DeviceCode" in record) return record;
      }
      const nested = findFirstDeviceRecord(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.DeviceList)) return findFirstDeviceRecord(record.DeviceList, depth + 1);
  for (const nested of Object.values(record)) {
    const found = findFirstDeviceRecord(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

async function inspect(url: URL, token: string) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  let message = "";
  let keys: string[] = [];
  let arrayLength: number | null = null;
  if (contentType.includes("json")) {
    try {
      const payload = await response.json() as unknown;
      if (Array.isArray(payload)) arrayLength = payload.length;
      else if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        keys = Object.keys(record).slice(0, 20);
        if (typeof record.message === "string") message = record.message.slice(0, 200);
      }
    } catch {}
  }
  return { status: response.status, contentType: contentType.split(";")[0], keys, arrayLength, message };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(new URL("login", base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-events-alias-probe", remember: true, force: false }),
    signal: AbortSignal.timeout(12000),
  });
  if (!loginResponse.ok) return Response.json({ error: "login_failed", status: loginResponse.status }, { status: 502 });
  const token = findToken(await loginResponse.json() as unknown);
  if (!token) return Response.json({ error: "missing_token" }, { status: 502 });

  const fleetResponse = await fetch(new URL("list?", base), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!fleetResponse.ok) return Response.json({ error: "fleet_failed", status: fleetResponse.status }, { status: 502 });
  const deviceRecord = findFirstDeviceRecord(await fleetResponse.json() as unknown);
  if (!deviceRecord) return Response.json({ error: "no_device_record" }, { status: 502 });

  const identities = [
    ["Device", stringValue(deviceRecord.Device)],
    ["DeviceCode", stringValue(deviceRecord.DeviceCode)],
    ["Index", stringValue(deviceRecord.Index)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  const rt = Math.floor(Date.now() / 1000);
  const rf = rt - 24 * 60 * 60;
  const seen = new Set<string>();
  const variants: Array<[string, Record<string, string>]> = [];
  for (const [field, value] of identities) {
    if (seen.has(value)) continue;
    seen.add(value);
    variants.push([`d_${field}`, { d: value, rf: String(rf), rt: String(rt), l: "250" }]);
    if (field === "Device") variants.push(["device_Device", { device: value, rf: String(rf), rt: String(rt), l: "250" }]);
  }

  const results = [];
  for (const [name, params] of variants.slice(0, 4)) {
    const url = new URL("events", base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    results.push({ name, ...(await inspect(url, token)) });
    if (results.at(-1)?.status === 429) break;
  }

  return Response.json({ identityFields: identities.map(([field]) => field), results }, { headers: { "cache-control": "no-store" } });
}
