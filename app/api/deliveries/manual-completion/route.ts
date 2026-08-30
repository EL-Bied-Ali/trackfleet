import { getCompanyAutomationSettings } from "trackfleet-auth-session-store";
import { completeDeliveryManually, confirmDepartureManually, observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { arrivalConfirmationRecommendation } from "../../../lib/arrival-confirmation";
import { getCompanySession } from "../../../lib/company-auth";
import { clampUnloadGraceMinutes, parseUnloadGraceMinutes } from "../../../lib/delivery-arrival";
import { knownSite } from "../../../lib/known-sites";
import { processPendingNotifications } from "../../../lib/notification-runner";
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
  const deliveries = await Promise.all(visible.map(async (delivery) => {
    const events = await store.listEvents(delivery.id);
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
  }));
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

      const now = new Date();
      const automationSettings = await getCompanyAutomationSettings(session.companyId);
      const unloadGraceMinutes = typeof automationSettings?.unloadGraceMinutes === "number"
        ? clampUnloadGraceMinutes(automationSettings.unloadGraceMinutes)
        : parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
      await observeArrivalCompletion({
        companyId: session.companyId,
        deliveryId,
        insideArrivalZone: true,
        observationAt: now,
        unloadGraceMinutes,
      });
      await store.recordEvent(deliveryId, "MANUAL_ARRIVAL_CONFIRMED", Math.min(99, delivery.progress));
      await store.recordEvent(deliveryId, "ARRIVED_AT_SITE", Math.min(99, delivery.progress));
      await processPendingNotifications(session.companyId, new URL(request.url).origin);
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
