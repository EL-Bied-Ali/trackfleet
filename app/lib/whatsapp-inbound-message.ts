import type { DeliveryRow } from "./delivery-store.types";

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

// A customer who messages first opens WhatsApp's free 24h customer service
// window, so this is a plain text reply -- not a template -- and unlike the
// automatic push side (whatsapp-message.ts), the tracking link travels as
// ordinary body text: Meta's anti-phishing restriction on raw URLs only
// applies to template body parameters, never to freeform messages.
// greetingName is passed in rather than always reading delivery.customer --
// either the sender or the recipient can text in (see
// findMostRecentActiveDeliveryByContact), and greeting the recipient by the
// sender's name would be wrong.
export function buildFoundReply(delivery: DeliveryRow, trackingUrl: string, greetingName: string) {
  return `Bonjour ${greetingName}, voici le suivi de votre colis ${delivery.id} (vers ${delivery.destination}) : ${trackingUrl}`;
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
