import { getCompanySession } from "../../../lib/company-auth";
import { createScannerPairing, revokeScannerFor } from "../../../lib/scanner-pairing";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  try {
    const pairing = await createScannerPairing(session);
    return json({ ...pairing, scope: session.siteId ?? "Compte central" });
  } catch {
    return json({ error: "scanner_pairing_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  try {
    await revokeScannerFor(session);
    return json({ ok: true });
  } catch {
    return json({ error: "scanner_pairing_unavailable" }, 503);
  }
}

