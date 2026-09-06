import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { getScannerSession } from "../../../lib/scanner-pairing";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

// Live request: let someone who scanned the wrong parcel while loading fix
// it themselves, instead of needing a dispatcher to intervene. Scoped to
// "loaded" only for now -- undoing "arrived" (hub) is a plain audit
// checkpoint with lower stakes either way, and undoing "delivered" isn't
// meaningful once WhatsApp may have already reached the customer (that
// checkpoint's own safety net is catching the mistake before it commits,
// see the location-mismatch check in scan/route.ts, not undoing it after).
const undoWindowMs = 30_000;

function noStore(body: Record<string, unknown>, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    const scannerResult = await getScannerSession(request);
    const session = scannerResult?.session ?? await getCompanySession(request);
    const refreshHeaders = scannerResult?.refreshedCookie ? { "set-cookie": scannerResult.refreshedCookie } : undefined;
    if (!session) return noStore({ error: "unauthorized" }, 401, refreshHeaders);

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();
    const deliveryId = String(payload.deliveryId ?? "").trim();
    const scanId = String(payload.scanId ?? "").trim();
    const checkpoint = String(payload.checkpoint ?? "");
    if (!deliveryId || !scanId) return noStore({ error: "invalid_request" }, 400, refreshHeaders);
    if (checkpoint !== "loaded") return noStore({ error: "checkpoint_not_undoable" }, 400, refreshHeaders);

    const undone = await store.undoRecentScan(session.companyId, deliveryId, scanId, undoWindowMs);
    if (!undone) return noStore({ error: "scan_not_found_or_too_old" }, 404, refreshHeaders);
    return noStore({ ok: true }, 200, refreshHeaders);
  } catch (error) {
    console.error("[trackfleet:scan] undo failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "undo_failed" }, 500);
  }
}
