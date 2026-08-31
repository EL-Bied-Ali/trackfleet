import { store } from "trackfleet-delivery-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { getCompanySession } from "../../lib/company-auth";
import { confirmArrivalManually } from "../../lib/confirm-arrival-manually";
import type { DeliveryScanCheckpoint } from "../../lib/delivery-store.types";
import { knownSite } from "../../lib/known-sites";
import { isValidParcelCode } from "../../lib/parcel-code";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";

// Just the two checkpoints that a per-parcel scan can actually add
// information the GPS automation can't already infer on its own: whether
// THIS parcel is on THIS truck, and whether it has physically reached
// destination. "Départ" is a truck-level event the automation tick already
// detects from GPS movement; "Livraison" is dropped too, since "arrived"
// now starts the same unload-grace completion timer that action would
// have (see confirm-arrival-manually.ts) -- a dispatcher can still finish
// early with the existing "Marquer livré" button when needed.
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
    const session = await getCompanySession(request);
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
    if (checkpoint === "arrived" && delivery.status === "Delivered") {
      return noStore({ error: "already_delivered" }, 409);
    }
    // Same restriction as the "Confirmer l'arrivée" button (manual-completion/
    // route.ts): an agency can only confirm arrival at its own destination --
    // agencyDeliveryIsVisible above is deliberately broader (also lets an
    // origin-side agency scan "loaded"), so arrival needs its own check.
    if (checkpoint === "arrived" && session.role === "agency" && delivery.destinationSiteId !== session.siteId) {
      return noStore({ error: "agency_destination_mismatch" }, 403);
    }

    const recentScans = await store.listScansForDelivery(delivery.id, 5);
    const now = Date.now();
    const duplicate = recentScans.some((scan) => scan.checkpoint === checkpoint && now - scan.scannedAt.getTime() < DUPLICATE_SCAN_WINDOW_MS);

    if (!duplicate) {
      await store.recordScan({
        companyId: session.companyId,
        deliveryId: delivery.id,
        checkpoint,
        scannedBy: session.userLabel,
        truck: delivery.truck || null,
        locationLabel: session.role === "agency" ? knownSite(session.siteId)?.label ?? null : null,
      });

      if (checkpoint === "arrived") {
        await confirmArrivalManually(session.companyId, delivery.id, delivery.progress, new URL(request.url).origin);
      } else {
        await store.recordEvent(delivery.id, "SCAN_LOADED", delivery.progress);
      }
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
