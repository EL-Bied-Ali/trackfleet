import { runtimeEnv } from "trackfleet-runtime-env";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

const apiBase = "http://backend2.sendatrack.com/sendatrack/public/api/";
const hostBase = "http://backend2.sendatrack.com";

function safeShape(value: unknown) {
  if (Array.isArray(value)) return { type: "array", length: value.length, firstKeys: value[0] && typeof value[0] === "object" ? Object.keys(value[0] as Record<string, unknown>).slice(0, 20) : [] };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 30) };
  return { type: typeof value };
}

async function summarize(response: Response) {
  const text = await response.text();
  let shape: unknown = null;
  try { shape = safeShape(JSON.parse(text)); } catch {}
  return { status: response.status, contentType: response.headers.get("content-type"), bodyLength: text.length, shape };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const loginResponse = await fetch(`${apiBase}login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accountID, user, password, machin: "trackfleet-history-probe", remember: true, force: false }),
    signal: AbortSignal.timeout(12000),
  });
  if (!loginResponse.ok) return Response.json({ stage: "login", status: loginResponse.status }, { status: 502 });
  const login = await loginResponse.json() as Record<string, unknown>;
  const token = typeof login.token === "string" ? login.token : "";
  if (!token) return Response.json({ stage: "login", error: "missing_token", keys: Object.keys(login).slice(0, 30) }, { status: 502 });

  const listResponse = await fetch(`${apiBase}list?`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  const list = await listResponse.json() as Record<string, unknown>;
  const deviceList = Array.isArray(list.DeviceList) ? list.DeviceList as Record<string, unknown>[] : [];
  const device = deviceList[0] ?? {};
  const deviceID = String(device.Device ?? "");

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 24 * 60 * 60;
  const eventQuery = new URLSearchParams({ a: accountID, u: user, p: password, d: deviceID, rf: String(fromSec), rt: String(nowSec), l: "10" }).toString();

  const checks: Array<{ name: string; method: "GET" | "POST"; url: string; body?: string; contentType?: string }> = [
    { name: "events_root", method: "GET", url: `${hostBase}/events/data.json?${eventQuery}` },
    { name: "events_sendatrack", method: "GET", url: `${hostBase}/sendatrack/events/data.json?${eventQuery}` },
    { name: "events_public", method: "GET", url: `${hostBase}/sendatrack/public/events/data.json?${eventQuery}` },
  ];

  const authXml = `<Authorization account="${accountID.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" user="${user.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}" password="${password.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"/>`;
  const dbGetXml = `<GTSRequest command="dbget">${authXml}<Record table="EventData" partial="true"><Field name="accountID">${accountID}</Field><Field name="deviceID">${deviceID}</Field></Record></GTSRequest>`;
  for (const path of ["/track/Service", "/sendatrack/track/Service", "/sendatrack/public/track/Service", "/Service"]) {
    checks.push({ name: `service_${path}`, method: "POST", url: `${hostBase}${path}`, body: dbGetXml, contentType: "text/xml" });
  }

  const results = [] as unknown[];
  for (const check of checks) {
    try {
      const response = await fetch(check.url, {
        method: check.method,
        headers: check.method === "POST" ? { "content-type": check.contentType ?? "text/plain", accept: "application/xml,text/xml,application/json,*/*" } : { accept: "application/json,*/*" },
        body: check.body,
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      results.push({ name: check.name, ...(await summarize(response)) });
    } catch (error) {
      results.push({ name: check.name, networkError: error instanceof Error ? error.name : "unknown" });
    }
  }

  return Response.json({ device: { id: deviceID, description: String(device.Device_desc ?? "") }, results }, { headers: { "cache-control": "no-store" } });
}
