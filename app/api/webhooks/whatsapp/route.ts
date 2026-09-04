import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { getCompanyBranding } from "trackfleet-auth-session-store";
import { normalizeCustomerPhone } from "../../../lib/customer-contact";
import { whatsappConsentWithdrawn } from "../../../lib/delivery-events";
import { sendWhatsAppTextReply, verifyWhatsAppWebhookSignature, verifyWhatsAppWebhookSubscription } from "../../../lib/whatsapp-inbound";
import { buildFoundReply, buildNoMatchAskNameReply, buildOptOutConfirmationReply, isOptOutMessage, parseInboundWhatsAppMessage } from "../../../lib/whatsapp-inbound-message";

const maxBodyBytes = 64 * 1024;

// Meta's one-time subscription handshake, performed when the webhook URL is
// registered in the App Dashboard (and whenever the subscription is
// re-verified). Must echo hub.challenge back as plain text on success.
export function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!verifyWhatsAppWebhookSubscription(mode, token) || !challenge) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  const appSecret = runtimeEnv.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) return Response.json({ error: "not_configured" }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) return Response.json({ error: "payload_too_large" }, { status: 413 });

  // Signature verification needs the exact raw bytes Meta signed -- read as
  // text first, verify, and only then JSON.parse, same reasoning as the
  // Paddle webhook route.
  const rawBody = await request.text();
  if (rawBody.length > maxBodyBytes) return Response.json({ error: "payload_too_large" }, { status: 413 });

  const signatureHeader = request.headers.get("x-hub-signature-256");
  const verified = await verifyWhatsAppWebhookSignature(rawBody, signatureHeader, appSecret);
  if (!verified) {
    console.error("[trackfleet:whatsapp] inbound webhook signature verification failed");
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const inbound = parseInboundWhatsAppMessage(payload);
  if (!inbound) {
    // Not a genuine inbound text message (a status update, template quality
    // change, etc.) -- acknowledged with 200 so Meta doesn't keep retrying
    // something this endpoint deliberately doesn't act on.
    return Response.json({ received: true }, { status: 200 });
  }

  const phone = normalizeCustomerPhone(inbound.from) ?? inbound.from;
  const origin = new URL(request.url).origin;

  try {
    // Meta requires honoring a customer's own opt-out request sent directly
    // via WhatsApp -- checked before the found/no-match lookup below, since
    // it applies regardless of whether a delivery match is found. Every
    // currently-active delivery for this phone (as either party) gets its
    // own WHATSAPP_OPT_OUT recorded -- whatsappConsentWithdrawn is checked
    // per-delivery from that delivery's own event log, so a customer with
    // more than one active parcel needs every one of them covered, not just
    // whichever single delivery a "most recent" lookup would have picked.
    if (isOptOutMessage(inbound.text)) {
      const activeDeliveries = await store.listActiveDeliveriesByContact(phone);
      await Promise.all(activeDeliveries.map(async (activeDelivery) => {
        const activeEvents = await store.listEvents(activeDelivery.id);
        if (!whatsappConsentWithdrawn(activeEvents)) {
          await store.recordEvent(activeDelivery.id, "WHATSAPP_OPT_OUT", activeDelivery.progress);
        }
      }));
      await sendWhatsAppTextReply(inbound.from, buildOptOutConfirmationReply());
      return Response.json({ received: true }, { status: 200 });
    }

    // Consent withdrawal deliberately does NOT suppress this reply -- unlike
    // the automatic push side, the customer is the one initiating contact
    // here, which is a different, always-permitted context under WhatsApp's
    // own policy (a business may always reply within the free 24h customer
    // service window a customer's own message opens).
    const delivery = await store.findMostRecentActiveDeliveryByContact(phone)
      ?? await store.findMostRecentActiveDeliveryByCustomerNameQuery(inbound.text);

    let reply: string;
    if (delivery) {
      const trackingUrl = new URL(origin);
      if (delivery.trackingToken) trackingUrl.searchParams.set("tracking", delivery.trackingToken);
      // Either the sender or the recipient can text in (see
      // findMostRecentActiveDeliveryByContact) -- greet whichever one
      // actually matched by phone, not always the sender. A match via the
      // name-search fallback (phone not on file at all) has no recipient
      // identity to fall back to, so it stays the sender's name.
      const greetingName = delivery.recipientContact && delivery.recipientContact === phone && delivery.contact !== phone
        ? (delivery.recipientName || delivery.customer)
        : delivery.customer;
      const branding = await getCompanyBranding(delivery.companyId);
      const parcelCount = delivery.shipmentId
        ? (await store.listForCompany(delivery.companyId)).filter((item) => item.shipmentId === delivery.shipmentId).length
        : 1;
      reply = buildFoundReply(delivery, trackingUrl.toString(), greetingName, branding?.name ?? null, parcelCount);
    } else {
      reply = buildNoMatchAskNameReply();
    }
    await sendWhatsAppTextReply(inbound.from, reply);
  } catch (error) {
    console.error("[trackfleet:whatsapp] inbound reply failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  // Always 200 once the payload itself is verified and parsed -- a failed
  // reply send is logged above but must never make Meta retry-storm the
  // same inbound message.
  return Response.json({ received: true }, { status: 200 });
}
