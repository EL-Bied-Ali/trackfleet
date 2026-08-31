import { store } from "trackfleet-delivery-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { getCompanySession } from "../../lib/company-auth";
import { getScannerSession } from "../../lib/scanner-pairing";
import type { DeliveryScanCheckpoint } from "../../lib/delivery-store.types";
import { knownSite } from "../../lib/known-sites";
import { isValidParcelCode } from "../../lib/parcel-code";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";

// Just the two checkpoints that a per-parcel scan can actually add
// information the GPS automation can't already infer on its own: whether
// THIS parcel is on THIS truck, and whether it has physically been unloaded
// at a hub. "Départ" is a truck-level event the automation tick already
// detects from GPS movement. A hub scan is audit-only: it never confirms a
// final delivery or notifies the customer.
const CHECKPOINTS: DeliveryScanCheckpoint[] = ["loaded", "arrived"];

// A shaky hand or a camera that keeps re-detecting the same code in frame
// shouldn't spam the audit trail with a dozen rows for one real scan --
// the client already debounces per detection, this is the server-side
// backstop for the same intent, scoped to "same delivery, same checkpoint".
const DUPLICATE_SCAN_WINDOW_MS = 30_000;

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    // A paired phone carries a separate, scan-only cookie. It is accepted
    // here and nowhere else in the application.
    const session = await getScannerSession(request) ?? await getCompanySession(request);
    if (!session) return noStore({ error: "unauthorized" }, 401);

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();

    const parcelCode = String(payload.parcelCode ?? "").trim().toUpperCase();
    if (!isValidParcelCode(parcelCode)) return noStore({ error: "invalid_parcel_code" }, 400);
    const checkpoint = String(payload.checkpoint ?? "") as DeliveryScanCheckpoint;
    if (!CHECKPOINTS.includes(checkpoint)) return noStore({ error: "invalid_checkpoint" }, 400);

    const delivery = await store.findByParcelCode(session.companyId, parcelCode);
    if (!delivery) return noStore({ error: "parcel_not_found" }, 404);
    if (session.role === "agency" && !agencyDeliveryIsVisible(delivery, session.siteId)) {
      return noStore({ error: "parcel_not_found" }, 404);
    }

    const recentScans = await store.listScansForDelivery(delivery.id, 5);
    const now = Date.now();
    const duplicate = recentScans.some((scan) => scan.checkpoint === checkpoint && now - scan.scannedAt.getTime() < DUPLICATE_SCAN_WINDOW_MS);

    if (!duplicate) {
      // Apply the checkpoint effect before writing its audit row. If the
      // effect fails transiently, the request can then be retried instead of
      // having the audit row make that retry look like a successful duplicate.
      // Both completion and timeline events are idempotent, so a later audit
      // failure is also safe to retry.
      if (checkpoint === "loaded") await store.recordEvent(delivery.id, "SCAN_LOADED", delivery.progress);

      await store.recordScan({
        companyId: session.companyId,
        deliveryId: delivery.id,
        checkpoint,
        scannedBy: session.userLabel,
        truck: delivery.truck || null,
        locationLabel: session.role === "agency" ? knownSite(session.siteId)?.label ?? null : null,
      });
    }

    const updated = await store.findByParcelCode(session.companyId, parcelCode);
    return noStore({
      ok: true,
      checkpoint,
      duplicate,
      delivery: updated ? {
        id: updated.id, customer: updated.customer, destination: updated.destination, status: updated.status,
      } : null,
    });
  } catch (error) {
    console.error("[trackfleet:scan] request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "scan_failed" }, 500);
  }
}
