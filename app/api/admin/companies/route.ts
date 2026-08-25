import { getAdminEmail } from "../../../lib/admin-auth";
import { listCompaniesWithSubscriptions } from "../../../lib/subscription-store";

export async function GET(request: Request) {
  const email = await getAdminEmail(request);
  if (!email) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const companies = await listCompaniesWithSubscriptions();
  return Response.json({ companies }, { headers: { "cache-control": "no-store" } });
}
