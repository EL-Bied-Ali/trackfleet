import { store } from "trackfleet-delivery-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { estimateRelayArrival } from "../../../lib/relay-eta-estimate";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function parseOptionalDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true as const, date: null };
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? { ok: true as const, date: parsed } : { ok: false as const, date: null };
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) {
    return Response.json({ error: "invalid_delivery_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const submittedPlannedArrival = parseOptionalDate(payload.plannedArrivalAt);
  const nextTruckDeparture = parseOptionalDate(payload.nextTruckDepartureAt);
  if (!submittedPlannedArrival.ok || !nextTruckDeparture.ok) {
    return Response.json({ error: "invalid_date" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const existing = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
  if (!existing) return Response.json({ error: "delivery_not_found_or_already_delivered" }, { status: 404 });

  // Same trusted, never-client-supplied computation the create route uses --
  // re-editing the departure date here (the whole point of reopening this
  // panel) recomputes the arrival estimate from the delivery's own
  // destination rather than trusting whatever the client sent. Falls back to
  // a client-submitted value only for a destination with no relay window.
  const plannedArrivalAt = estimateRelayArrival(existing.destinationSiteId, nextTruckDeparture.date) ?? submittedPlannedArrival.date;

  const delivery = await store.updateSchedule(deliveryId, session.companyId, {
    plannedArrivalAt,
    nextTruckDepartureAt: nextTruckDeparture.date,
  });
  if (!delivery) return Response.json({ error: "delivery_not_found_or_already_delivered" }, { status: 404 });
  return Response.json({ delivery }, { headers: { "cache-control": "no-store" } });
}
