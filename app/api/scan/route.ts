import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { getCompanySession } from "../../lib/company-auth";
import { getScannerSession } from "../../lib/scanner-pairing";
import type { DeliveryScanCheckpoint } from "../../lib/delivery-store.types";
import { knownSite } from "../../lib/known-sites";
import { isValidParcelCode } from "../../lib/parcel-code";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";
import { distanceKm } from "../../lib/route-progress";

// A hub scan is usually done from a dispatcher-paired phone (no fixed
// siteId to name), unlike an agency's own scan which already knows its
// site. Reported live: the hub scan proof showed only a date, never a
// place. Originally named from the truck's own live SENDATRACK position
// alone (only the GPS-tracked hubs -- Casablanca, Tanger Med -- carry real
// coordinates; see known-sites.ts's finalLegTrackingUnavailable split).
//
// Once the scanning phone's own position became available (best-effort,
// see /scan's watchPosition), it fully REPLACED the truck position here
// rather than the phone being tried first with the truck as a fallback --
// live feedback: "faut pas le scanner dise qu'il a scanné dans une
// position dont le tel ne confirme pas". The truck's GPS and the scanning
// phone are two different devices; falling back to the truck's position
// when the phone stayed silent would print a confident-looking location
// the phone itself never actually confirmed. No phone position -> no
// location shown, same as before hub scans ever got one. Capped to a
// tight radius so a stale or off-grid phone position never mislabels the
// scan with a wrong hub name either.
const HUB_MATCH_RADIUS_KM = 5;

async function nearestGeocodedSiteLabel(companyId: string, position: { latitude: number | null; longitude: number | null } | null) {
  if (!position || position.latitude === null || position.longitude === null) return null;
  const sites = await siteStore.listForCompany(companyId);
  let closest: { label: string; distanceKm: number } | null = null;
  for (const site of sites) {
    if (typeof site.latitude !== "number" || typeof site.longitude !== "number") continue;
    const distance = distanceKm([position.longitude, position.latitude], [site.longitude, site.latitude]);
    if (!closest || distance < closest.distanceKm) closest = { label: site.label, distanceKm: distance };
  }
  return closest && closest.distanceKm <= HUB_MATCH_RADIUS_KM ? closest.label : null;
}

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
    // Best-effort: the scanning phone's own position at the moment of the
    // scan, if it granted location permission (see /scan's watchPosition).
    // Never required for the scan itself to succeed -- a scan with no
    // coordinates, or coordinates that don't land near a known site,
    // simply gets no location label at all (see nearestGeocodedSiteLabel's
    // own comment for why that's deliberate, not a fallback gap).
    const phoneLatitude = Number(payload.latitude);
    const phoneLongitude = Number(payload.longitude);
    const phonePosition = Number.isFinite(phoneLatitude) && Number.isFinite(phoneLongitude)
      && phoneLatitude >= -90 && phoneLatitude <= 90 && phoneLongitude >= -180 && phoneLongitude <= 180
      ? { latitude: phoneLatitude, longitude: phoneLongitude }
      : null;

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
      await store.recordEvent(
        delivery.id,
        checkpoint === "loaded" ? "SCAN_LOADED" : "SCAN_HUB_ARRIVED",
        delivery.progress,
      );

      const locationLabel = session.role === "agency"
        ? knownSite(session.siteId)?.label ?? null
        : await nearestGeocodedSiteLabel(session.companyId, phonePosition);

      await store.recordScan({
        companyId: session.companyId,
        deliveryId: delivery.id,
        checkpoint,
        scannedBy: session.userLabel,
        truck: delivery.truck || null,
        locationLabel,
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
