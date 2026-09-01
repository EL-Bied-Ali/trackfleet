import { getAdminEmail } from "../../../../lib/admin-auth";
import { logAdminAction } from "../../../../lib/admin-audit-log";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";
import { invalidJsonResponse, readJsonObject } from "../../../../lib/request-json";
import { setReferredByCompanyId } from "../../../../lib/subscription-store";

// Sets (or clears, with null) which company referred another one -- the
// only place the referral program's reward trigger (see
// app/lib/referral-reward.ts, fired from the Paddle webhook) reads this
// from. Logged the same way subscription overrides are: it's what turns a
// real Paddle payment into a real discount on someone else's invoice.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const email = await getAdminEmail(request);
  if (!email) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  const companyId = String(payload.companyId ?? "").trim();
  const referredByCompanyIdRaw = payload.referredByCompanyId;
  const referredByCompanyId = referredByCompanyIdRaw === null ? null : String(referredByCompanyIdRaw ?? "").trim();
  if (!companyId || referredByCompanyId === companyId) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  await setReferredByCompanyId(companyId, referredByCompanyId || null);
  await logAdminAction({ adminEmail: email, action: "referral_set", targetCompanyId: companyId, detail: `referredByCompanyId=${referredByCompanyId || "none"}` })
    .catch((error) => console.error("[trackfleet:admin] audit log write failed", { message: error instanceof Error ? error.message : "unknown_error" }));

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
