import { runtimeEnv } from "trackfleet-runtime-env";

export { verifyWhatsAppWebhookSignature } from "./whatsapp-inbound-message";

const metaRequestTimeoutMs = 10_000;

// The one-time GET handshake Meta performs when the webhook URL is
// registered/subscribed in the App Dashboard, proving TrackFleet controls
// this endpoint. Distinct from the App Secret used for per-request signature
// verification (see whatsapp-inbound-message.ts): this token is chosen by
// us (any string), not issued by Meta.
export function verifyWhatsAppWebhookSubscription(mode: string | null, token: string | null) {
  const configured = runtimeEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  return Boolean(configured) && mode === "subscribe" && token === configured;
}

export async function sendWhatsAppTextReply(to: string, text: string): Promise<{ sent: boolean }> {
  const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return { sent: false };

  const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
    signal: AbortSignal.timeout(metaRequestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:whatsapp] inbound reply send failed", { status: response.status });
    return { sent: false };
  }
  return { sent: true };
}
