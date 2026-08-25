import { getAdminEmail } from "../../../../lib/admin-auth";
import { logAdminAction } from "../../../../lib/admin-audit-log";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";
import { invalidJsonResponse, readJsonObject } from "../../../../lib/request-json";
import { upsertSubscription, type SubscriptionStatus } from "../../../../lib/subscription-store";

const validStatuses: SubscriptionStatus[] = ["grandfathered", "trialing", "active", "past_due", "canceled"];

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (validStatuses as string[]).includes(value);
}

// Manually overrides a company's subscription status, bypassing Paddle
// entirely -- for comping a customer, extending access while a payment
// issue gets sorted out, or correcting a webhook that never arrived.
// Logged to admin_audit_log since it's a real, consequential override of
// the paid-access gate.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const email = await getAdminEmail(request);
  if (!email) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  const companyId = String(payload.companyId ?? "").trim();
  const status = payload.status;
  if (!companyId || !isSubscriptionStatus(status)) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  await upsertSubscription({ companyId, status });
  await logAdminAction({ adminEmail: email, action: "subscription_override", targetCompanyId: companyId, detail: `status=${status}` })
    .catch((error) => console.error("[trackfleet:admin] audit log write failed", { message: error instanceof Error ? error.message : "unknown_error" }));

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
