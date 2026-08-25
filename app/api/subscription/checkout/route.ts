import { getCompanySession } from "../../../lib/company-auth";
import { createPaddleCheckout, paddleCheckoutConfigured } from "../../../lib/paddle-checkout";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);

  if (!paddleCheckoutConfigured()) return json({ error: "not_configured" }, 503);

  const checkout = await createPaddleCheckout(session.companyId);
  if (!checkout) return json({ error: "checkout_unavailable" }, 502);

  return json({ url: checkout.url }, 200);
}
