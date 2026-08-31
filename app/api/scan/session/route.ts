import { getCompanySession } from "../../../lib/company-auth";
import { getScannerSession } from "../../../lib/scanner-pairing";

export async function GET(request: Request) {
  const scanner = await getScannerSession(request);
  const session = scanner ?? await getCompanySession(request);
  if (!session) return Response.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
  return Response.json({
    authenticated: true,
    scannerOnly: scanner !== null,
    company: { account: session.accountLabel, role: session.role, siteId: session.siteId },
  }, { headers: { "cache-control": "no-store" } });
}
