import { getCompanySession } from "../../../lib/company-auth";
import { getScannerSession } from "../../../lib/scanner-pairing";

export async function GET(request: Request) {
  const scannerResult = await getScannerSession(request);
  const session = scannerResult?.session ?? await getCompanySession(request);
  if (!session) return Response.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
  // Opening /scan is the first thing that happens on every real use of a
  // paired phone, so it's also where a due-for-refresh session's
  // Set-Cookie most reliably gets back to the browser -- see
  // getScannerSession's own comment for why the cookie itself needs
  // reissuing, not just the server-side record.
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (scannerResult?.refreshedCookie) headers["set-cookie"] = scannerResult.refreshedCookie;
  return Response.json({
    authenticated: true,
    scannerOnly: scannerResult !== null,
    // Lets the paired phone's own screen show which device it's connected
    // as (e.g. "Ahmed - Camion 3"), so a driver can confirm at a glance
    // it's really their own persistent pairing, not someone else's.
    deviceLabel: scannerResult?.session.deviceLabel ?? null,
    company: { account: session.accountLabel, role: session.role, siteId: session.siteId },
  }, { headers });
}
