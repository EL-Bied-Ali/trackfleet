import type { DeliveryRow } from "./delivery-store.types";
import { knownSite } from "./known-sites.ts";

// Kept free of trackfleet-runtime-env (unlike whatsapp-inbound.ts, which
// actually sends the reply) so this pure parsing/text-building/signature
// logic can be unit-tested directly with plain Node, matching the
// whatsapp-message.ts / whatsapp-automation.ts split already established
// for the outbound side, and paddle-webhook.ts for the signature part.

// Meta signs every webhook POST body with the Meta App's App Secret (distinct
// from WHATSAPP_ACCESS_TOKEN) as `X-Hub-Signature-256: sha256=<hex>`,
// HMAC-SHA256 over the raw, unparsed body -- same reasoning as
// verifyPaddleWebhookSignature in paddle-webhook.ts: this is what actually
// authenticates the request, so it must run against the exact bytes Meta
// signed, before any JSON.parse. Without this, anyone could POST a crafted
// payload claiming to be from an arbitrary phone number and get this
// endpoint to send a reply (and leak which delivery matched) to that number.
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyWhatsAppWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const signature = signatureHeader.slice(prefix.length);
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualHex(expected, signature);
}

export type InboundWhatsAppMessage = { from: string; text: string };

// A customer receiving a freeform WhatsApp reply from an unfamiliar number
// has no way to know it's actually from the company that's shipping their
// parcel (TrackFleet is the tracking SaaS behind it, not a name the customer
// ever chose to talk to) -- signing with the company's own configured brand
// name (see getCompanyBranding in trackfleet-auth-session-store) closes
// that gap. Omitted entirely for a
// company that hasn't set one, leaving the message exactly as before.
function signMessage(text: string, companyName: string | null) {
  return companyName ? `${text}\n\n— ${companyName}` : text;
}

// Meta's webhook payload carries many event types on the same endpoint
// (message status updates, template quality changes, account alerts...) --
// this only recognizes a genuine inbound text message and returns null for
// everything else, so the caller can safely no-op (still 200) on anything
// it doesn't need to react to.
export function parseInboundWhatsAppMessage(payload: unknown): InboundWhatsAppMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const entry = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) return null;
  for (const entryItem of entry) {
    const changes = (entryItem as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const from = (message as { from?: unknown })?.from;
        const text = (message as { text?: { body?: unknown } })?.text?.body;
        if (typeof from === "string" && from && typeof text === "string") return { from, text };
      }
    }
  }
  return null;
}

// Meta's WhatsApp Business Platform policy requires honoring a customer's
// own opt-out request sent directly via WhatsApp -- previously the only way
// to withdraw consent was a dispatcher clicking a button in the internal
// dashboard, with no customer-facing self-service mechanism at all, even
// though manual "Notifier par WhatsApp" sends (independent of the
// automation-enabled flag) already reach real customers today. Deliberately
// a short, exact-word allowlist (not a substring match) so an ordinary
// message that happens to contain one of these words as part of a longer
// sentence isn't misread as an opt-out.
const optOutWords = new Set(["stop", "arret", "arrêt", "desabonner", "désabonner", "unsubscribe"]);

export function isOptOutMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[\s.!?]+$/, "");
  return optOutWords.has(normalized);
}

export function buildOptOutConfirmationReply(): string {
  return "C'est noté : vous ne recevrez plus de messages WhatsApp de notre part pour vos livraisons en cours. Vous pouvez toujours suivre vos colis via le lien de suivi déjà reçu.";
}

function formatEstimatedDate(date: Date) {
  return date.toLocaleDateString("fr-BE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPrice(amount: number, currency: "EUR" | "MAD") {
  return `${amount.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// A customer who messages first opens WhatsApp's free 24h customer service
// window, so this is a plain text reply -- not a template -- and unlike the
// automatic push side (whatsapp-message.ts), the tracking link travels as
// ordinary body text: Meta's anti-phishing restriction on raw URLs only
// applies to template body parameters, never to freeform messages.
// greetingName is passed in rather than always reading delivery.customer --
// either the sender or the recipient can text in (see
// findMostRecentActiveDeliveryByContact), and greeting the recipient by the
// sender's name would be wrong.
//
// Requested live: a customer's first message should get the full picture up
// front (sender, recipient, agency, parcel count, weight/description, price,
// both estimated dates) rather than just a bare tracking link -- this is
// still the same free customer-service-window reply, so there's no added
// cost to including more. Both dates are explicitly framed as estimates
// ("peut évoluer") rather than firm commitments, same honesty rule
// etaExplanation/customerEtaNote already apply on the tracking page itself.
// parcelCount (how many parcels share this delivery's shipmentId, looked up
// by the caller -- this module stays free of the store) is only mentioned
// when the customer's parcel isn't traveling alone.
export function buildFoundReply(delivery: DeliveryRow, trackingUrl: string, greetingName: string, companyName: string | null = null, parcelCount = 1) {
  const agency = knownSite(delivery.destinationSiteId)?.label ?? delivery.destination;
  const lines = [
    `Bonjour ${greetingName}, voici les informations de votre colis ${delivery.id} :`,
    `Expéditeur : ${delivery.customer}`,
    delivery.recipientName ? `Destinataire : ${delivery.recipientName}` : null,
    `Agence : ${agency}`,
    parcelCount > 1 ? `Colis : ${parcelCount} colis liés à cet envoi` : null,
    delivery.weightKg != null
      ? `Poids : ${delivery.weightKg.toLocaleString("fr-BE", { maximumFractionDigits: 3 })} kg`
      : delivery.itemDescription
        ? `Contenu : ${delivery.itemDescription}`
        : null,
    delivery.priceAmount != null && delivery.priceCurrency ? `Prix : ${formatPrice(delivery.priceAmount, delivery.priceCurrency)}` : null,
    `Départ estimé : ${delivery.nextTruckDepartureAt ? formatEstimatedDate(delivery.nextTruckDepartureAt) : "à confirmer"}`,
    `Arrivée estimée : ${delivery.plannedArrivalAt ? formatEstimatedDate(delivery.plannedArrivalAt) : "à confirmer"} (estimation, peut évoluer)`,
    `Suivi : ${trackingUrl}`,
  ].filter((line): line is string => line !== null);
  return signMessage(lines.join("\n"), companyName);
}

// Used both on a customer's first contact (no delivery on this phone number)
// and after an attempted name search that still found nothing -- there's no
// conversation state tracked between messages, so this endpoint can't tell
// "first hello" apart from "just tried a name that didn't match". Always
// guiding toward the same next action (send first + last name) is correct
// either way, rather than risking a wrong "we searched for X" message when
// the customer's text wasn't actually a name attempt.
export function buildNoMatchAskNameReply() {
  return "Nous n'avons pas trouvé de colis actif associé à ce numéro. Pouvez-vous nous répondre avec votre prénom et nom pour qu'on le retrouve ?";
}

// Sent by an agency dispatcher's explicit "Notifier par WhatsApp" action
// (app/api/deliveries/notify-arrival/route.ts), not automatically -- only
// deliverable while a real customer-opened 24h window is still open, same
// freeform-message constraint as buildFoundReply. Mentions the link is
// closing soon rather than omitting it, since the whole point of this
// action is to also tighten the link's expiry (see tracking-access.ts).
export function buildArrivalNotificationMessage(delivery: DeliveryRow, trackingUrl: string, greetingName: string, companyName: string | null = null) {
  return signMessage(`Bonjour ${greetingName}, votre colis ${delivery.id} est arrivé à destination (${delivery.destination}) et est prêt pour la récupération. Suivi (accès bientôt clôturé) : ${trackingUrl}`, companyName);
}

// Sent by a dispatcher's explicit "Notifier par WhatsApp" action on a
// departure confirmation (app/api/deliveries/notify-departure/route.ts), not
// automatically -- DEPARTED is deliberately excluded from the automatic push
// set (see automaticWhatsAppEvents in notification-policy.ts, to control
// message volume/cost), but that exclusion is about the paid,
// business-initiated template push, not this free customer-service-window
// reply, so a dispatcher can still choose to send this one for a specific
// delivery. Unlike buildArrivalNotificationMessage, this doesn't tighten the
// tracking link's expiry, so there's no "closing soon" framing here.
//
// Mentions delivery.plannedArrivalAt (the same trusted, server-computed
// estimate the creation form and schedule editor show -- see
// relay-eta-estimate.ts) when one exists, so the customer gets a rough
// arrival date up front rather than only finding out from the tracking
// link. Omitted entirely rather than guessed when no estimate is on file
// (e.g. a departure confirmed without ever setting a next-truck-departure
// date), matching the "don't invent an estimate" rule used everywhere else
// this value is shown.
export function buildDepartureNotificationMessage(delivery: DeliveryRow, trackingUrl: string, greetingName: string, companyName: string | null = null) {
  const estimate = delivery.plannedArrivalAt ? ` Arrivée estimée : ${formatEstimatedDate(delivery.plannedArrivalAt)}.` : "";
  return signMessage(`Bonjour ${greetingName}, votre colis ${delivery.id} vient de démarrer son trajet vers ${delivery.destination}.${estimate} Vous recevrez le numéro de l'agence dès que votre colis sera arrivé. Suivi : ${trackingUrl}`, companyName);
}
