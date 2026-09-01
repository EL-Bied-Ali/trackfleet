import { getCompanySession } from "../../lib/company-auth";
import { grantOneFreeInvoice } from "../../lib/paddle-referral";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";

// TEMPORARY, live-verification-only route: exercises grantOneFreeInvoice
// against a real Paddle sandbox subscription id, using the app's own
// already-configured PADDLE_API_KEY. Not reachable from anywhere in the
// UI. Delete this file once the referral reward's Paddle Discounts +
// Subscriptions PATCH calls have been confirmed working against the real
// (sandbox) API -- see the "Not yet verified" note on PR #241.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const paddleSubscriptionId = String(payload.paddleSubscriptionId ?? "").trim();
  if (!paddleSubscriptionId) return Response.json({ error: "paddleSubscriptionId required" }, { status: 400, headers: { "cache-control": "no-store" } });

  const granted = await grantOneFreeInvoice(paddleSubscriptionId);
  return Response.json({ granted }, { headers: { "cache-control": "no-store" } });
}
