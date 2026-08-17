import { runtimeEnv } from "trackfleet-runtime-env";

const CURRENT_BASE = "http://backend2.sendatrack.com/sendatrack/public/api/";
const TMS_BASE = "http://debug.sendatrack.com/tms/public/api/";

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

function findDevice(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDevice(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["Device", "DeviceCode", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  for (const nested of Object.values(record)) {
    const found = findDevice(nested, depth + 1);
    if (found) return found;
  }
  return "";
}

async function inspect(url: URL, token: string) {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    let keys: string[] = [];
    let arrayLength: number | null = null;
    let message = "";
    if (contentType.includes("json")) {
      try {
        const payload = await response.json() as unknown;
        if (Array.isArray(payload)) arrayLength = payload.length;
        else if (payload && typeof payload === "object") {
          const record = payload as Record<string, unknown>;
          keys = Object.keys(record).slice(0, 20);
          if (typeof record.message === "string") message = record.message.slice(0, 180);
          else if (typeof record.error === "string") message = record.error.slice(0, 180);
        }
      } catch {}
    }
    return { status: response.status, contentType: contentType.split(";")[0], keys, arrayLength, message };
  } catch (error) {
    return { status: 0, contentType: "", keys: [], arrayLength: null, message: error instanceof Error ? error.name : "error" };
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(new URL("login", CURRENT_BASE), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-modern-history-probe", remember: true, force: false }),
    signal: AbortSignal.timeout(12000),
  });
  if (!loginResponse.ok) return Response.json({ error: "login_failed", status: loginResponse.status }, { status: 502 });
  const token = findToken(await loginResponse.json() as unknown);
  if (!token) return Response.json({ error: "missing_token" }, { status: 502 });

  const fleetResponse = await fetch(new URL("list?", CURRENT_BASE), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!fleetResponse.ok) return Response.json({ error: "fleet_failed", status: fleetResponse.status }, { status: 502 });
  const device = findDevice(await fleetResponse.json() as unknown);
  if (!device) return Response.json({ error: "missing_device" }, { status: 502 });

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const dateStart = start.toISOString().slice(0, 10);
  const dateEnd = end.toISOString().slice(0, 10);

  const currentTrip = new URL("trajet-jour", CURRENT_BASE);
  currentTrip.searchParams.set("Device", device);
  currentTrip.searchParams.set("DT", dateStart);
  currentTrip.searchParams.set("DTF", dateEnd);
  for (const flag of ["k", "na", "da", "dc", "c", "t", "v", "addi", "addf"]) currentTrip.searchParams.append(flag, "");

  const currentResult = await inspect(currentTrip, token);
  let detailResult: Awaited<ReturnType<typeof inspect>> | null = null;
  let tmsResult: Awaited<ReturnType<typeof inspect>> | null = null;

  if (currentResult.status !== 429) {
    const detail = new URL("eventspagination", CURRENT_BASE);
    detail.searchParams.set("Device", device);
    detail.searchParams.set("DT", dateStart);
    detail.searchParams.set("DTF", dateEnd);
    detailResult = await inspect(detail, token);
  }

  if (currentResult.status === 404 && detailResult?.status === 404) {
    const tmsTrip = new URL("trajet-jour", TMS_BASE);
    tmsTrip.searchParams.set("Device", device);
    tmsTrip.searchParams.set("DT", dateStart);
    tmsTrip.searchParams.set("DTF", dateEnd);
    for (const flag of ["k", "na", "da", "dc", "c", "t", "v", "addi", "addf"]) tmsTrip.searchParams.append(flag, "");
    tmsResult = await inspect(tmsTrip, token);
  }

  return Response.json({ currentTrip: currentResult, currentDetail: detailResult, tmsTrip: tmsResult }, { headers: { "cache-control": "no-store" } });
}
