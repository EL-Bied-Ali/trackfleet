import { runtimeEnv } from "trackfleet-runtime-env";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

const base = "http://backend2.sendatrack.com/sendatrack/public/api/";

function safeShape(value: unknown) {
  if (Array.isArray(value)) return { type: "array", length: value.length, firstKeys: value[0] && typeof value[0] === "object" ? Object.keys(value[0] as Record<string, unknown>).slice(0, 20) : [] };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 30) };
  return { type: typeof value };
}

async function readJson(response: Response) {
  const text = await response.text();
  try { return { value: JSON.parse(text), length: text.length }; } catch { return { value: null, length: text.length }; }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(`${base}login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-history-probe", remember: true, force: false }),
    signal: AbortSignal.timeout(12000),
  });
  if (!loginResponse.ok) return Response.json({ stage: "login", status: loginResponse.status }, { status: 502 });
  const login = await loginResponse.json() as Record<string, unknown>;
  const token = typeof login.token === "string" ? login.token : "";
  if (!token) return Response.json({ stage: "login", error: "missing_token", keys: Object.keys(login).slice(0, 30) }, { status: 502 });

  const listResponse = await fetch(`${base}list?`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  const listParsed = await readJson(listResponse);
  const list = listParsed.value;

  function findCandidate(value: unknown, depth = 0): Record<string, unknown> | null {
    if (depth > 5) return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = findCandidate(item, depth + 1); if (found) return found; }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some(k => /^(id|imei|device|deviceid|vehicleid|unitid|objectid)$/i.test(k))) return record;
    for (const child of Object.values(record)) { const found = findCandidate(child, depth + 1); if (found) return found; }
    return null;
  }

  const candidate = findCandidate(list);
  const candidateKeys = candidate ? Object.keys(candidate).slice(0, 40) : [];
  const identifierEntries = candidate ? Object.entries(candidate).filter(([k,v]) => /id|imei|device|unit|object/i.test(k) && (typeof v === "string" || typeof v === "number")).slice(0, 12) : [];
  const identifiers = Object.fromEntries(identifierEntries);
  const id = String(identifierEntries[0]?.[1] ?? "");

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isoFrom = from.toISOString();
  const isoTo = now.toISOString();
  const dayFrom = isoFrom.slice(0,10);
  const dayTo = isoTo.slice(0,10);
  const query = new URLSearchParams({ id, from: isoFrom, to: isoTo, start: isoFrom, end: isoTo, dateFrom: dayFrom, dateTo: dayTo }).toString();

  const paths = ["history", "history?", "route", "routes", "track", "tracks", "trip", "trips", "positions", "reports/history"];
  const results = [] as unknown[];
  for (const path of paths) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${base}${path}${separator}${query}`;
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
      const parsed = await readJson(response);
      results.push({ path, status: response.status, contentType: response.headers.get("content-type"), bodyLength: parsed.length, shape: parsed.value === null ? null : safeShape(parsed.value) });
    } catch (error) {
      results.push({ path, networkError: error instanceof Error ? error.name : "unknown" });
    }
  }

  return Response.json({ listStatus: listResponse.status, listShape: list === null ? null : safeShape(list), candidateKeys, identifiers, results }, { headers: { "cache-control": "no-store" } });
}
