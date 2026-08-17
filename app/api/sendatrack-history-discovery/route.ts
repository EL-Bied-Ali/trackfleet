import { runtimeEnv } from "trackfleet-runtime-env";
import { normalizeSendatrackFleet } from "../../lib/sendatrack-normalize";

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

async function inspect(response: Response) {
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
    } catch (error) {
      message = error instanceof Error ? `json:${error.name}` : "json:error";
    }
  }
  return { status: response.status, allow: response.headers.get("allow"), contentType: contentType.split(";")[0], keys, arrayLength, message };
}

export async function GET() {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(new URL("login", base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-history-method-discovery", remember: true, force: false }),
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
  const vehicle = normalizeSendatrackFleet(await fleetResponse.json() as unknown).vehicles[0];
  if (!vehicle) return Response.json({ error: "no_vehicle" }, { status: 502 });

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const eventsUrl = new URL("events", base);
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };

  const options = await fetch(eventsUrl, { method: "OPTIONS", headers, signal: AbortSignal.timeout(7000) })
    .then(inspect)
    .catch((error) => ({ status: 0, allow: null, contentType: "", keys: [] as string[], arrayLength: null, message: error instanceof Error ? error.name : "error" }));

  const post = await fetch(eventsUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      device: vehicle.id,
      deviceId: vehicle.id,
      vehicle: vehicle.id,
      vehicleId: vehicle.id,
      from: start.toISOString(),
      to: end.toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }),
    signal: AbortSignal.timeout(7000),
  }).then(inspect)
    .catch((error) => ({ status: 0, allow: null, contentType: "", keys: [] as string[], arrayLength: null, message: error instanceof Error ? error.name : "error" }));

  return Response.json({ options, post }, { headers: { "cache-control": "no-store" } });
}
