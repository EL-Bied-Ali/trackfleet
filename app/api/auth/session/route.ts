import { deleteCompanySession, getCompanySession } from "../../../lib/company-auth";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ authenticated: false }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ authenticated: true, company: { account: session.accountLabel, user: session.userLabel } }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  return Response.json({ authenticated: false }, { headers: { "set-cookie": await deleteCompanySession(request), "cache-control": "no-store" } });
}
