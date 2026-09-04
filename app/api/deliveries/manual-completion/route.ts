import { completeDeliveryManually, confirmDepartureManually } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { arrivalConfirmationRecommendation } from "../../../lib/arrival-confirmation";
import { getCompanySession } from "../../../lib/company-auth";
import { confirmArrivalManually } from "../../../lib/confirm-arrival-manually";
import { knownSite } from "../../../lib/known-sites";
import { readJsonObject, invalidJsonResponse } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const active = (await store.listForCompany(session.companyId))
    .filter((delivery) => delivery.status !== "Delivered");
  const visible = session.role === "agency"
    ? active.filter((delivery) => delivery.destinationSiteId === session.siteId)
    : active;
  // One company-scoped query instead of one store.listEvents call per
  // delivery -- the same "Too many subrequests" shape that took down
  // GET /api/deliveries at real trip/delivery volume (2026-09-02), found
  // here during the follow-up audit before it did the same thing to this
  // screen.
  const eventsByDeliveryId = await store.listEventsForDeliveries(session.companyId, visible.map((delivery) => delivery.id));
  const deliveries = visible.map((delivery) => {
    const events = eventsByDeliveryId.get(delivery.id) ?? [];
    const recommendation = arrivalConfirmationRecommendation({
      ...delivery,
      events,
      finalLegTrackingUnavailable: knownSite(delivery.destinationSiteId)?.finalLegTrackingUnavailable === true,
    });
    return {
      id: delivery.id,
      customer: delivery.customer,
      destination: delivery.destination,
      truck: delivery.truck,
      status: delivery.status,
      progress: delivery.progress,
      arrivalState: recommendation.state,
      arrivalReason: recommendation.reason,
    };
  });
  return noStore({ deliveries });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);
  if (payload.confirmArrival !== true && payload.confirmDelivered !== true && payload.confirmDeparture !== true) {
    return noStore({ error: "delivery_confirmation_required" }, 400);
  }
  if (session.role === "agency" && (payload.confirmDelivered === true || payload.confirmDeparture === true)) {
    return noStore({ error: "dispatcher_confirmation_required" }, 403);
  }

  try {
    if (payload.confirmDeparture === true) {
      // Unlike confirmArrival (whose ARRIVED_AT_SITE is one of the two
      // automatic-push-worthy events -- see notification-policy.ts), DEPARTED
      // is deliberately excluded from the automatic push set, so there's
      // nothing for processPendingNotifications to do here.
      const departed = await confirmDepartureManually(session.companyId, deliveryId);
      if (!departed) return noStore({ error: "delivery_not_found_or_not_loading" }, 404);
      const delivery = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
      return noStore({ ok: true, deliveryId, status: "In transit", departureConfirmed: true, delivery });
    }

    if (payload.confirmArrival === true) {
      const delivery = (await store.listForCompany(session.companyId))
        .find((candidate) => candidate.id === deliveryId && candidate.status !== "Delivered");
      if (!delivery) return noStore({ error: "delivery_not_found_or_already_delivered" }, 404);
      if (session.role === "agency" && delivery.destinationSiteId !== session.siteId) {
        return noStore({ error: "agency_destination_mismatch" }, 403);
      }

      // Client asked (from a photo of the depot's own paper process): a
      // parcel can only be confirmed arrived -- moving it toward "Delivered"
      // and out of the active table -- once it was physically scanned at
      // both the depot (loaded) and the hub. Without this, a dispatcher
      // could click arrival on a parcel that was never actually scanned
      // through either real checkpoint, silently losing the paper trail.
      //
      // Live follow-up: this should be a warning the dispatcher/agency can
      // choose to bypass (a real edge case exists -- a scan that failed to
      // register for some technical reason on a parcel that IS actually
      // there), not an unconditional block. bypassMissingScans is a
      // separate, explicit flag the client only sends after the dispatcher
      // has already seen this exact warning once and chosen to proceed
      // anyway -- never the same click as the original confirm attempt.
      const [scanSummary] = await store.listScanSummaries(session.companyId, [deliveryId]);
      const missingLoadedScan = !scanSummary?.loadedAt;
      const missingHubScan = !scanSummary?.hubArrivedAt;
      if ((missingLoadedScan || missingHubScan) && payload.bypassMissingScans !== true) {
        return noStore({ error: "arrival_blocked_missing_scans", missingLoadedScan, missingHubScan }, 409);
      }
      if (missingLoadedScan || missingHubScan) {
        console.warn("[trackfleet:deliveries] arrival confirmed despite missing scans (explicit bypass)", {
          deliveryId, companyId: session.companyId, missingLoadedScan, missingHubScan,
        });
      }

      const { unloadGraceMinutes } = await confirmArrivalManually(session.companyId, deliveryId, delivery.progress, new URL(request.url).origin);
      const updated = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
      return noStore({ ok: true, deliveryId, arrivalConfirmed: true, automaticCompletionAfterMinutes: unloadGraceMinutes, delivery: updated });
    }

    const completed = await completeDeliveryManually(session.companyId, deliveryId);
    if (!completed) return noStore({ error: "delivery_not_found_or_already_delivered" }, 404);
    return noStore({ ok: true, deliveryId, status: "Delivered", progress: 100 });
  } catch (error) {
    console.error("[trackfleet:deliveries] manual completion failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "manual_completion_failed" }, 500);
  }
}
