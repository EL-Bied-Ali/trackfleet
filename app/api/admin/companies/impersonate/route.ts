import { getAdminEmail } from "../../../../lib/admin-auth";
import { logAdminAction } from "../../../../lib/admin-audit-log";
import { createCompanySession, decryptCredentials } from "../../../../lib/company-auth";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";
import { invalidJsonResponse, readJsonObject } from "../../../../lib/request-json";
import { getCompanyCredentialsCiphertext } from "../../../../lib/subscription-store";

// Mints a normal dispatcher session for the target company, exactly as if
// that company had logged in themselves -- reuses createCompanySession (the
// same function the real login route and the Google-link flow call), so
// impersonation is never a separate, less-verified path into a company's
// data. The admin never sees the company's plaintext SENDATRACK password:
// it's decrypted here, used once to mint the session, and discarded.
// Every call is logged, since this exposes real customer data.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();

  const email = await getAdminEmail(request);
  if (!email) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  const companyId = String(payload.companyId ?? "").trim();
  if (!companyId) return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });

  const ciphertext = await getCompanyCredentialsCiphertext(companyId);
  if (!ciphertext) return Response.json({ error: "company_not_found" }, { status: 404, headers: { "cache-control": "no-store" } });

  try {
    const credentials = await decryptCredentials(ciphertext);
    const result = await createCompanySession(credentials);
    await logAdminAction({ adminEmail: email, action: "impersonate", targetCompanyId: companyId })
      .catch((error) => console.error("[trackfleet:admin] audit log write failed", { message: error instanceof Error ? error.message : "unknown_error" }));
    return Response.json({ company: result.company }, { headers: { "set-cookie": result.cookie, "cache-control": "no-store" } });
  } catch (error) {
    console.error("[trackfleet:admin] impersonation failed", {
      companyId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return Response.json({ error: "impersonation_failed" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
