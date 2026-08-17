import { runtimeEnv } from "trackfleet-runtime-env";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function safeKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, 20);
}

async function probe(name: string, url: string, body: BodyInit, contentType: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": contentType,
        accept: "application/json, text/plain, */*",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let keys: string[] = [];
    try { keys = safeKeys(JSON.parse(text)); } catch {}
    return {
      name,
      status: response.status,
      statusText: response.statusText,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      responseKeys: keys,
      bodyLength: text.length,
    };
  } catch (error) {
    return {
      name,
      networkError: error instanceof Error ? error.name : "unknown",
    };
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  const password = runtimeEnv.SENDATRACK_PASSWORD ?? "";
  if (!accountID || !user || !password) return Response.json({ error: "not_configured" }, { status: 503 });

  const full = { accountID, user, password, machin: "trackfleet-connector", remember: true, force: false };
  const minimal = { accountID, user, password };
  const httpsUrl = "https://backend2.sendatrack.com/sendatrack/public/api/login";
  const httpUrl = "http://backend2.sendatrack.com/sendatrack/public/api/login";

  const results = [];
  results.push(await probe("http_json_full", httpUrl, JSON.stringify(full), "application/json"));
  results.push(await probe("https_json_full", httpsUrl, JSON.stringify(full), "application/json"));
  results.push(await probe("https_json_minimal", httpsUrl, JSON.stringify(minimal), "application/json"));
  results.push(await probe("https_form_minimal", httpsUrl, new URLSearchParams(minimal), "application/x-www-form-urlencoded"));

  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
