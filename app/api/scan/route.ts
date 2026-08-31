import { completeDeliveryManually } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { getCompanySession } from "../../lib/company-auth";
import type { DeliveryScanCheckpoint } from "../../lib/delivery-store.types";
import { knownSite } from "../../lib/known-sites";
import { isValidParcelCode } from "../../lib/parcel-code";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";

const CHECKPOINTS: DeliveryScanCheckpoint[] = ["loaded", "departed", "arrived", "delivered"];

// SCAN_LOADED/SCAN_DEPARTED/SCAN_ARRIVED are internal bookkeeping markers
// (see delivery-events.ts) recorded purely so the checkpoint shows up in
// the existing dispatcher/customer timeline -- they never touch
// status/progress, unlike "delivered" below. There's no SCAN_DELIVERED:
// that checkpoint reuses completeDeliveryManually directly, the exact
// path the existing "Marquer livré" button already uses (see
// app/api/deliveries/manual-completion/route.ts), rather than inventing a
// second, competing way to move status/progress.
const CHECKPOINT_EVENT: Partial<Record<DeliveryScanCheckpoint, "SCAN_LOADED" | "SCAN_DEPARTED" | "SCAN_ARRIVED">> = {
  loaded: "SCAN_LOADED",
  departed: "SCAN_DEPARTED",
  arrived: "SCAN_ARRIVED",
};

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

      if (checkpoint === "delivered") {
        await completeDeliveryManually(session.companyId, delivery.id);
      } else {
        const eventType = CHECKPOINT_EVENT[checkpoint];
        if (eventType) await store.recordEvent(delivery.id, eventType, delivery.progress);
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
