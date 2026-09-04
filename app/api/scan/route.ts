import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import { agencyDeliveryIsVisible } from "../../lib/agency-access";
import { getCompanySession } from "../../lib/company-auth";
import { confirmArrivalManually } from "../../lib/confirm-arrival-manually";
import { notifyArrivalManually } from "../../lib/notify-arrival-manually";
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
// the phone itself never actually confirmed. No phone position -> still no
// location shown. A phone position that IS confirmed but too far from any
// known site (or a known site with no GPS coordinates on file -- see
// project_trackfleet_site_gps_status) falls through to a reverse-geocoded
// city label instead (see reverseGeocodedLabel below) -- still the phone's
// own honest confirmation, just not resolved to a known-site name. The
// radius only protects the human-readable site NAME from a stale/off-grid
// mismatch, never the reverse-geocoded fallback itself.
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

// Live follow-up: "si trop loin du site, je veut qu'il nous donne la loca
// actuel du tel meme si c'est pas une agence" -- a phone position that
// exists but isn't near any known site (e.g. mid-corridor, or a site with
// no GPS coordinates on file yet -- see project_trackfleet_site_gps_status)
// used to mean no location at all. The phone DID confirm a real position
// though, so it's still honest to show it -- unlike the removed truck-GPS
// fallback, which showed a position from a different device the phone
// never confirmed.
//
// First shipped as plain coordinates, then corrected the same day: "non pas
// de coordonné brute, je voulais plutot le nom de la ville et si possible
// un quartier aproximatif quand on clique". Reverse-geocodes through
// OpenStreetMap's free Nominatim API (no key needed -- the same service
// AgencyLocationSetup.tsx already embeds for its own map preview) into a
// "City" or "City · neighbourhood/road" label, matching the exact " · "
// convention known site labels already use (e.g. "Bruxelles · Boulevard de
// l'Abattoir") so the client can treat both the same way: show the city
// compactly, reveal the rest on click. Bounded to a short timeout so a
// slow/down geocoder never meaningfully delays a scan; anything that fails
// or can't resolve a city renders no location, same as having no phone
// position at all -- never raw coordinates again.
async function reverseGeocodedLabel(position: { latitude: number; longitude: number } | null) {
  if (!position) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${position.latitude}&lon=${position.longitude}&zoom=14&addressdetails=1`;
    const response = await fetch(url, {
      headers: { "User-Agent": "TrackFleet/1.0 (scan location lookup)", "Accept-Language": "fr" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { address?: Record<string, string> };
    const address = data.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? null;
    if (!city) return null;
    const detail = address.suburb ?? address.neighbourhood ?? address.road ?? null;
    return detail && detail !== city ? `${city} · ${detail}` : city;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Three checkpoints a per-parcel scan can add information the GPS
// automation can't already infer on its own: whether THIS parcel is on
// THIS truck, whether it's been physically unloaded at a hub (audit-only --
// never confirms final delivery or notifies the customer), and now whether
// it's actually reached the destination agency. "Départ" is a truck-level
// event the automation tick already detects from GPS movement, so no scan
// checkpoint exists for it.
const CHECKPOINTS: DeliveryScanCheckpoint[] = ["loaded", "arrived", "delivered"];

// A shaky hand or a camera that keeps re-detecting the same code in frame
// shouldn't spam the audit trail with a dozen rows for one real scan --
// the client already debounces per detection, this is the server-side
// backstop for the same intent, scoped to "same delivery, same checkpoint".
const DUPLICATE_SCAN_WINDOW_MS = 30_000;

function noStore(body: Record<string, unknown>, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    // A paired phone carries a separate, scan-only cookie. It is accepted
    // here and nowhere else in the application. A scan is real, regular
    // use of the device, so a due-for-refresh session's Set-Cookie rides
    // along on whatever response this request ends up returning (see
    // getScannerSession's own comment for why the cookie itself, not just
    // the server-side record, needs reissuing).
    const scannerResult = await getScannerSession(request);
    const session = scannerResult?.session ?? await getCompanySession(request);
    const refreshHeaders = scannerResult?.refreshedCookie ? { "set-cookie": scannerResult.refreshedCookie } : undefined;
    if (!session) return noStore({ error: "unauthorized" }, 401, refreshHeaders);

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();

    const parcelCode = String(payload.parcelCode ?? "").trim().toUpperCase();
    if (!isValidParcelCode(parcelCode)) return noStore({ error: "invalid_parcel_code" }, 400, refreshHeaders);
    const checkpoint = String(payload.checkpoint ?? "") as DeliveryScanCheckpoint;
    if (!CHECKPOINTS.includes(checkpoint)) return noStore({ error: "invalid_checkpoint" }, 400, refreshHeaders);
    // A device paired for one fixed post (see /scan/connect and
    // scanner-pairing.ts) hides the checkpoint picker client-side, but the
    // server enforces it too -- defense in depth against a stale page
    // still holding an old mode in memory, not just the UI removing the choice.
    const lockedCheckpoint = scannerResult?.session.checkpoint;
    if (lockedCheckpoint && checkpoint !== lockedCheckpoint) {
      return noStore({ error: "checkpoint_locked", lockedCheckpoint }, 403, refreshHeaders);
    }
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
    if (!delivery) return noStore({ error: "parcel_not_found" }, 404, refreshHeaders);
    if (session.role === "agency" && !agencyDeliveryIsVisible(delivery, session.siteId)) {
      return noStore({ error: "parcel_not_found" }, 404, refreshHeaders);
    }

    if (checkpoint === "delivered") {
      // Same permission rule as the dashboard's "Confirmer l'arrivée"
      // button (manual-completion/route.ts): a dispatcher can confirm any
      // delivery, an agency only its own destination site's -- an agency
      // that merely originated this parcel (agencyDeliveryIsVisible above
      // also allows that, for return shipments) must not be able to scan it
      // as delivered.
      if (session.role === "agency" && delivery.destinationSiteId !== session.siteId) {
        return noStore({ error: "agency_destination_mismatch" }, 403, refreshHeaders);
      }
      if (delivery.status === "Delivered") {
        return noStore({ error: "already_delivered" }, 409, refreshHeaders);
      }
      // Same paper-trail rule as the button flow, client request (from a
      // photo of the depot's own paper process): a parcel can only be
      // confirmed arrived once it was physically scanned at both the depot
      // (loaded) and the hub -- otherwise a scan here would let the exact
      // gap this rule exists to catch back in through a second door.
      const [scanSummary] = await store.listScanSummaries(session.companyId, [delivery.id]);
      if (!scanSummary?.loadedAt || !scanSummary?.hubArrivedAt) {
        return noStore({
          error: "arrival_blocked_missing_scans",
          missingLoadedScan: !scanSummary?.loadedAt,
          missingHubScan: !scanSummary?.hubArrivedAt,
        }, 409, refreshHeaders);
      }
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
      if (checkpoint === "delivered") {
        // The exact same effect the "Confirmer l'arrivée" button triggers
        // (MANUAL_ARRIVAL_CONFIRMED + ARRIVED_AT_SITE, the unload-grace
        // timer) -- a scan here is just a second, more rigorous path into
        // it, not a different outcome. Also fires the same freeform
        // WhatsApp arrival message the button's own click handler fires
        // (see notifyArrivalManually's own comment for why this is a
        // separate call: processPendingNotifications above is a no-op
        // while WHATSAPP_AUTOMATION_ENABLED stays off, so without this the
        // scan would confirm arrival but never actually tell the customer).
        const origin = new URL(request.url).origin;
        await confirmArrivalManually(session.companyId, delivery.id, delivery.progress, origin);
        await notifyArrivalManually(session.companyId, delivery, origin);
      } else {
        await store.recordEvent(
          delivery.id,
          checkpoint === "loaded" ? "SCAN_LOADED" : "SCAN_HUB_ARRIVED",
          delivery.progress,
        );
      }

      const locationLabel = session.role === "agency"
        ? knownSite(session.siteId)?.label ?? null
        : (await nearestGeocodedSiteLabel(session.companyId, phonePosition)) ?? (await reverseGeocodedLabel(phonePosition));

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
    }, 200, refreshHeaders);
  } catch (error) {
    console.error("[trackfleet:scan] request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "scan_failed" }, 500);
  }
}
