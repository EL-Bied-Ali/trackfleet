import { runtimeEnv } from "trackfleet-runtime-env";

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

const candidates = [
  "history", "histories", "historique", "historiqueTrajet", "historique-trajet",
  "trip", "trips", "tripHistory", "trip-history", "trajectory", "trajectories",
  "route", "routes", "routeHistory", "route-history", "dailyRoute", "daily-route",
  "itinerary", "itineraries", "itineraire", "itineraireJournalier",
  "events", "event", "eventData", "event-data", "positions", "positionHistory", "position-history",
  "deviceHistory", "device-history", "vehicleHistory", "vehicle-history", "trackingHistory", "tracking-history",
  "reports", "report", "journey", "journeys", "movement", "movements", "stops", "stopHistory"
];

async function probe(path: string, token: string) {
  try {
    const response = await fetch(new URL(path, base), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    let keys: string[] = [];
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 404 && contentType.includes("json")) {
      try {
        const payload = await response.clone().json() as unknown;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) keys = Object.keys(payload as Record<string, unknown>).slice(0, 12);
      } catch {}
    }
    return { path, status: response.status, contentType: contentType.split(";")[0], keys };
  } catch (error) {
    return { path, status: 0, contentType: "", keys: [], error: error instanceof Error ? error.name : "error" };
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

  const results: Awaited<ReturnType<typeof probe>>[] = [];
  for (let i = 0; i < candidates.length; i += 6) {
    results.push(...await Promise.all(candidates.slice(i, i + 6).map((path) => probe(path, token))));
  }
  return Response.json({
    tested: results.length,
    interesting: results.filter((item) => item.status !== 404),
    notFound: results.filter((item) => item.status === 404).length,
  }, { headers: { "cache-control": "no-store" } });
}
