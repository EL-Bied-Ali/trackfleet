import { consumeLoginAttempt, clearLoginAttempts } from "trackfleet-login-rate-limit";
import { createCompanySession } from "../../../lib/company-auth";
import { publicLoginFailure } from "../../../lib/login-error";
import { readJsonObject } from "../../../lib/request-json";
import { requestIsSameOrigin } from "../../../lib/request-origin";

const loginWindowMs = 10 * 60_000;
const maxLoginAttempts = 8;
const recentLoginAttempts = new Map<string, number[]>();

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function allowLocalLoginAttempt(key: string) {
  const now = Date.now();
  const cutoff = now - loginWindowMs;
  const recent = (recentLoginAttempts.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= maxLoginAttempts) {
    recentLoginAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  recentLoginAttempts.set(key, recent);

  if (recentLoginAttempts.size > 1_000) {
    for (const [candidate, timestamps] of recentLoginAttempts) {
      if (!timestamps.some((timestamp) => timestamp >= cutoff)) recentLoginAttempts.delete(candidate);
    }
  }
  return true;
}

async function loginAttemptDecision(request: Request) {
  try {
    const decision = await consumeLoginAttempt(request);
    if (decision.distributed) return decision;
  } catch (error) {
    console.error("[trackfleet:auth] distributed login rate limiter unavailable", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  return {
    allowed: allowLocalLoginAttempt(clientKey(request)),
    retryAfterSeconds: Math.ceil(loginWindowMs / 1000),
    distributed: false,
  };
}

async function resetLoginAttempts(request: Request) {
  recentLoginAttempts.delete(clientKey(request));
  try {
    await clearLoginAttempts(request);
  } catch (error) {
    console.error("[trackfleet:auth] failed to clear distributed login rate limiter", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return json({ error: "origin_not_allowed" }, 403);

  const decision = await loginAttemptDecision(request);
  if (!decision.allowed) {
    return json(
      { error: "too_many_login_attempts" },
      429,
      { "retry-after": String(decision.retryAfterSeconds) },
    );
  }

  const payload = await readJsonObject(request);
  if (!payload) return json({ error: "invalid_request" }, 400);

  try {
    const result = await createCompanySession({
      accountID: String(payload.accountID ?? "").trim().slice(0, 120),
      user: String(payload.user ?? "").trim().slice(0, 120),
      password: String(payload.password ?? "").slice(0, 512),
    });
    await resetLoginAttempts(request);
    return Response.json({ company: result.company, vehicleCount: result.vehicles.length }, {
      headers: { "set-cookie": result.cookie, "cache-control": "no-store" },
    });
  } catch (error) {
    const failure = publicLoginFailure(error);
    return json({ error: failure.code }, failure.status);
  }
}
