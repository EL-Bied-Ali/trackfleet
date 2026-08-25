import { consumeLoginAttempt, clearLoginAttempts } from "trackfleet-login-rate-limit";
import { createCompanySession, verifyGooglePendingLinkToken } from "../../../../lib/company-auth";
import { createGoogleLink } from "../../../../lib/google-link-store";
import { clientAddress } from "../../../../lib/login-rate-limit-key";
import { publicLoginFailure } from "../../../../lib/login-error";
import { readJsonObject } from "../../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";

// This endpoint verifies a SENDATRACK password just like the plain login
// route, so it needs the exact same brute-force protection -- a distributed
// limiter first, an in-memory per-isolate fallback if that's unavailable.
const loginWindowMs = 10 * 60_000;
const maxLoginAttempts = 8;
const recentLoginAttempts = new Map<string, number[]>();

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
    allowed: allowLocalLoginAttempt(clientAddress(request)),
    retryAfterSeconds: Math.ceil(loginWindowMs / 1000),
    distributed: false,
  };
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const decision = await loginAttemptDecision(request);
  if (!decision.allowed) {
    return json({ error: "too_many_login_attempts" }, 429, { "retry-after": String(decision.retryAfterSeconds) });
  }

  const payload = await readJsonObject(request);
  if (!payload) return json({ error: "invalid_request" }, 400);

  const pendingToken = String(payload.pendingToken ?? "");
  let identity: { sub: string; email: string };
  try {
    identity = await verifyGooglePendingLinkToken(pendingToken);
  } catch {
    return json({ error: "google_link_expired" }, 401);
  }

  try {
    const result = await createCompanySession({
      accountID: String(payload.accountID ?? "").trim().slice(0, 120),
      user: String(payload.user ?? "").trim().slice(0, 120),
      password: String(payload.password ?? "").slice(0, 512),
    });
    await createGoogleLink({ googleSub: identity.sub, email: identity.email, companyId: result.companyId });
    recentLoginAttempts.delete(clientAddress(request));
    await clearLoginAttempts(request).catch(() => undefined);
    return Response.json({ company: result.company, vehicleCount: result.vehicles.length }, {
      headers: { "set-cookie": result.cookie, "cache-control": "no-store" },
    });
  } catch (error) {
    const failure = publicLoginFailure(error);
    return json({ error: failure.code }, failure.status);
  }
}
