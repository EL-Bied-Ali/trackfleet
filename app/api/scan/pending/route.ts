import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { getScannerSession } from "../../../lib/scanner-pairing";
import { computePendingScanList } from "../../../lib/scan-pending";
import type { DeliveryScanCheckpoint } from "../../../lib/delivery-store.types";

const validCheckpoints: DeliveryScanCheckpoint[] = ["loaded", "arrived", "delivered"];

function noStore(body: Record<string, unknown>, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

// Live request: "I wanna have at least a list of the parcels they are
// supposed to still scan... not leaving out/forgetting parcels" -- see
// computePendingScanList for the actual per-checkpoint scoping; this route
// is just the auth/data-fetch wrapper around it.
export async function GET(request: Request) {
  try {
    const scannerResult = await getScannerSession(request);
    const session = scannerResult?.session ?? await getCompanySession(request);
    const refreshHeaders = scannerResult?.refreshedCookie ? { "set-cookie": scannerResult.refreshedCookie } : undefined;
    if (!session) return noStore({ error: "unauthorized" }, 401, refreshHeaders);

    // A locked device (see scanner-pairing.ts) always uses its own
    // checkpoint -- the whole point of the lock is that this device never
    // needs the person to pick anything, the pending list included. An
    // unlocked device (a dispatcher's own login, or a pre-lock paired
    // phone) falls back to the ?checkpoint= query param, matching whatever
    // mode the page's own picker currently has selected.
    const requestedCheckpoint = scannerResult?.session.checkpoint
      ?? String(new URL(request.url).searchParams.get("checkpoint") ?? "") as DeliveryScanCheckpoint;
    if (!validCheckpoints.includes(requestedCheckpoint)) return noStore({ error: "invalid_checkpoint" }, 400, refreshHeaders);

    const deliveries = (await store.listForCompany(session.companyId)).filter((delivery) => delivery.status !== "Delivered");
    const summaries = new Map((await store.listScanSummaries(session.companyId, deliveries.map((delivery) => delivery.id)))
      .map((summary) => [summary.deliveryId, summary]));
    const agencySiteId = session.role === "agency" ? session.siteId : null;
    const result = computePendingScanList(requestedCheckpoint, deliveries, summaries, agencySiteId);
    return noStore(result, 200, refreshHeaders);
  } catch (error) {
    console.error("[trackfleet:scan] pending list failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "pending_list_failed" }, 500);
  }
}
