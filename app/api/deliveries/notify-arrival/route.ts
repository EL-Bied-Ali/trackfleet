import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { notifyArrivalManually } from "../../../lib/notify-arrival-manually";
import { readJsonObject, invalidJsonResponse } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Same scoping as the existing "Confirmer l'arrivée" action in
// manual-completion/route.ts: the dispatcher can trigger this for any
// delivery, an agency only for its own destination site's. Widened from
// agency-only so the table's inline "confirm arrival" action (which any
// dispatcher can use) can also fire this notify, not just the agency-side
// popover. The actual send (consent check, idempotency, message build,
// freeform send, WHATSAPP_ARRIVAL_NOTIFIED marker) lives in
// notify-arrival-manually.ts, shared with the "Livré à l'agence" scan
// checkpoint -- this route is just the HTTP/permission wrapper around it.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);

  const delivery = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
  if (!delivery) return noStore({ error: "delivery_not_found" }, 404);
  if (session.role === "agency" && delivery.destinationSiteId !== session.siteId) {
    return noStore({ error: "agency_destination_mismatch" }, 403);
  }

  const result = await notifyArrivalManually(session.companyId, delivery, new URL(request.url).origin);
  if (!result.ok && result.reason) return noStore({ error: result.reason }, result.reason === "consent_withdrawn" ? 403 : 400);
  return noStore(result);
}
