import { getCompanySession } from "../../../lib/company-auth";
import { createPaddleCheckout, isPaddleInterval, isPaddlePlan, paddleCheckoutConfigured, paddleClientConfig } from "../../../lib/paddle-checkout";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// The Paddle.js overlay checkout needs a client-side token before it can
// even render -- this is public config (the token is meant to be embedded
// in frontend JS by design), fetched once when the subscribe screen mounts.
export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  if (!paddleCheckoutConfigured()) return json({ error: "not_configured" }, 503);

  const clientConfig = paddleClientConfig();
  if (!clientConfig) return json({ error: "not_configured" }, 503);
  return json(clientConfig, 200);
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);

  if (!paddleCheckoutConfigured()) return json({ error: "not_configured" }, 503);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const plan = payload.plan;
  const interval = payload.interval;
  if (!isPaddlePlan(plan) || !isPaddleInterval(interval)) return json({ error: "invalid_plan" }, 400);

  const checkout = await createPaddleCheckout(session.companyId, plan, interval);
  if (!checkout) return json({ error: "checkout_unavailable" }, 502);

  return json({ transactionId: checkout.transactionId }, 200);
}
