import { getCompanySession } from "../../../lib/company-auth";
import { getScannerSession } from "../../../lib/scanner-pairing";

export async function GET(request: Request) {
  const scanner = await getScannerSession(request);
  const session = scanner ?? await getCompanySession(request);
  if (!session) return Response.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
  return Response.json({
    authenticated: true,
    scannerOnly: scanner !== null,
    // Lets the paired phone's own screen show which device it's connected
    // as (e.g. "Ahmed - Camion 3"), so a driver can confirm at a glance
    // it's really their own persistent pairing, not someone else's.
    deviceLabel: scanner?.deviceLabel ?? null,
    company: { account: session.accountLabel, role: session.role, siteId: session.siteId },
  }, { headers: { "cache-control": "no-store" } });
}
