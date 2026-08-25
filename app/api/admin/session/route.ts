import { clearAdminSessionCookie, getAdminEmail } from "../../../lib/admin-auth";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

export async function GET(request: Request) {
  const email = await getAdminEmail(request);
  if (!email) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ email }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  return new Response(null, { status: 204, headers: { "set-cookie": clearAdminSessionCookie() } });
}
