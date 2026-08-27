import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { buildArrivalNotificationMessage } from "../../../lib/whatsapp-inbound-message";
import { sendWhatsAppTextReply } from "../../../lib/whatsapp-inbound";
import { readJsonObject, invalidJsonResponse } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Only the agency at a delivery's own destination site can trigger this --
// same scoping as the existing "Confirmer l'arrivée" action in
// manual-completion/route.ts. Attempts a freeform WhatsApp reply to both
// contact numbers on file (whichever actually has an open 24h window, per
// Meta's own free customer-service-window rules, is the one that succeeds;
// this endpoint doesn't try to track that state itself -- see
// whatsapp-inbound.ts's sendWhatsAppTextReply). On any success, records
// WHATSAPP_ARRIVAL_NOTIFIED once, which tightens the public tracking link's
// expiry (see trackingLinkExpiryAnchorFromEvents in delivery-events.ts) --
// the explicit product intent behind this whole action.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  if (session.role !== "agency") return noStore({ error: "agency_only" }, 403);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);

  const delivery = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
  if (!delivery) return noStore({ error: "delivery_not_found" }, 404);
  if (delivery.destinationSiteId !== session.siteId) return noStore({ error: "agency_destination_mismatch" }, 403);

  const origin = new URL(request.url).origin;
  const trackingUrl = new URL(origin);
  if (delivery.trackingToken) trackingUrl.searchParams.set("tracking", delivery.trackingToken);

  const recipients = [
    delivery.recipientContact ? { phone: delivery.recipientContact, name: delivery.recipientName || delivery.customer } : null,
    delivery.contact && delivery.contact !== delivery.recipientContact ? { phone: delivery.contact, name: delivery.customer } : null,
  ].filter((entry): entry is { phone: string; name: string } => entry !== null);

  if (!recipients.length) return noStore({ error: "no_contact_on_file" }, 400);

  const results = await Promise.all(recipients.map(async (recipient) => {
    const message = buildArrivalNotificationMessage(delivery, trackingUrl.toString(), recipient.name);
    const { sent } = await sendWhatsAppTextReply(recipient.phone, message);
    return { phone: recipient.phone, sent };
  }));

  const anySent = results.some((result) => result.sent);
  if (anySent) await store.recordEvent(deliveryId, "WHATSAPP_ARRIVAL_NOTIFIED", delivery.progress);

  return noStore({ ok: anySent, results });
}
