import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeSendatrackFleet } from "../../../lib/sendatrack-normalize";

export const dynamic = "force-dynamic";
const base = "http://backend2.sendatrack.com/sendatrack/public/api/";

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

async function inspect(url: URL, token: string) {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(7000),
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
          keys = Object.keys(record).slice(0, 15);
          if (typeof record.message === "string") message = record.message.slice(0, 200);
        }
      } catch {}
    }
    return { status: response.status, contentType: contentType.split(";")[0], keys, arrayLength, message };
  } catch (error) {
    return { status: 0, contentType: "", keys: [], arrayLength: null, message: error instanceof Error ? error.name : "error" };
  }
}

export async function GET() {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(new URL("login", base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-history-discovery", remember: true, force: false }),
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
  const fleetPayload = await fleetResponse.json() as unknown;
  const vehicle = normalizeSendatrackFleet(fleetPayload).vehicles[0];
  if (!vehicle) return Response.json({ error: "no_vehicle" }, { status: 502 });

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  const dateStart = isoStart.slice(0, 10);
  const dateEnd = isoEnd.slice(0, 10);
  const unixStart = Math.floor(start.getTime() / 1000);
  const unixEnd = Math.floor(end.getTime() / 1000);

  const variants: Array<[string, Record<string, string>]> = [
    ["bare", {}],
    ["device", { device: vehicle.id }],
    ["deviceId", { deviceId: vehicle.id }],
    ["Device", { Device: vehicle.id }],
    ["id", { id: vehicle.id }],
    ["vehicle", { vehicle: vehicle.id }],
    ["vehicleId", { vehicleId: vehicle.id }],
    ["device_from_to_iso", { device: vehicle.id, from: isoStart, to: isoEnd }],
    ["device_start_end_iso", { device: vehicle.id, start: isoStart, end: isoEnd }],
    ["device_dateFrom_dateTo", { device: vehicle.id, dateFrom: isoStart, dateTo: isoEnd }],
    ["device_from_to_date", { device: vehicle.id, from: dateStart, to: dateEnd }],
    ["device_from_to_unix", { device: vehicle.id, from: String(unixStart), to: String(unixEnd) }],
    ["Device_startDate_endDate", { Device: vehicle.id, startDate: isoStart, endDate: isoEnd }],
    ["vehicleId_startDate_endDate", { vehicleId: vehicle.id, startDate: isoStart, endDate: isoEnd }],
  ];

  const results = [] as Array<{ variant: string; status: number; contentType: string; keys: string[]; arrayLength: number | null; message: string }>;
  for (let i = 0; i < variants.length; i += 4) {
    const batch = variants.slice(i, i + 4);
    results.push(...await Promise.all(batch.map(async ([variant, params]) => {
      const url = new URL("events", base);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return { variant, ...await inspect(url, token) };
    })));
  }

  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
