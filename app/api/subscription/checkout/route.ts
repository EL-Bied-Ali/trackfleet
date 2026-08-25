import { getCompanySession } from "../../../lib/company-auth";
import { createPaddleCheckout, isPaddleInterval, isPaddlePlan, paddleCheckoutConfigured } from "../../../lib/paddle-checkout";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
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

  return json({ url: checkout.url }, 200);
}
