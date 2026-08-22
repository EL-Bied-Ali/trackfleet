import { deleteCompanySession, getCompanySessionWithRenewal } from "../../../lib/company-auth";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

export async function GET(request: Request) {
  const result = await getCompanySessionWithRenewal(request);
  if (!result) return Response.json({ authenticated: false }, { status: 401, headers: { "cache-control": "no-store" } });
  const { session } = result;
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (result.renewedCookie) headers["set-cookie"] = result.renewedCookie;
  return Response.json({ authenticated: true, company: { account: session.accountLabel, user: session.role === "agency" ? session.siteId : session.userLabel, role: session.role, siteId: session.siteId } }, { headers });
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  return Response.json({ authenticated: false }, { headers: { "set-cookie": await deleteCompanySession(request), "cache-control": "no-store" } });
}
