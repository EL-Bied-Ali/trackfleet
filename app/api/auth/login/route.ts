import { createCompanySession } from "../../../lib/company-auth";

const loginWindowMs = 10 * 60_000;
const maxLoginAttempts = 8;
const recentLoginAttempts = new Map<string, number[]>();

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function allowLoginAttempt(key: string) {
  const now = Date.now();
  const cutoff = now - loginWindowMs;
  const recent = (recentLoginAttempts.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= maxLoginAttempts) {
    recentLoginAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  recentLoginAttempts.set(key, recent);

  // Keep the in-memory protection bounded on long-lived instances. Vercel may
  // run multiple instances, so this is defense in depth rather than a global
  // account lockout mechanism.
  if (recentLoginAttempts.size > 1_000) {
    for (const [candidate, timestamps] of recentLoginAttempts) {
      if (!timestamps.some((timestamp) => timestamp >= cutoff)) recentLoginAttempts.delete(candidate);
    }
  }
  return true;
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "origin_not_allowed" }, 403);

  const key = clientKey(request);
  if (!allowLoginAttempt(key)) {
    return json({ error: "too_many_login_attempts" }, 429, { "retry-after": "600" });
  }

  try {
    const payload = await request.json() as Record<string, unknown>;
    const result = await createCompanySession({
      accountID: String(payload.accountID ?? "").trim().slice(0, 120),
      user: String(payload.user ?? "").trim().slice(0, 120),
      password: String(payload.password ?? "").slice(0, 512),
    });
    recentLoginAttempts.delete(key);
    return Response.json({ company: result.company, vehicleCount: result.vehicles.length }, {
      headers: { "set-cookie": result.cookie, "cache-control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "login_failed";
    const status = code === "missing_credentials" ? 400 : code === "authentication_failed" ? 401 : 503;
    return json({ error: code }, status);
  }
}
