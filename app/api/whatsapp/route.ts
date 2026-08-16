import { runtimeEnv } from "trackfleet-runtime-env";
import { getCompanySession } from "../../lib/company-auth";
import { normalizeCustomerPhone } from "../../lib/customer-contact";

type WhatsAppKind = "tracking" | "arrival";

const graphApiVersion = "v25.0";
const recentDemoEvents: Array<{ deliveryId: string; kind: WhatsAppKind; createdAt: number }> = [];

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function enforceRateLimit(deliveryId: string, kind: WhatsAppKind) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  while (recentDemoEvents.length && recentDemoEvents[0].createdAt < oneHourAgo) recentDemoEvents.shift();
  if (recentDemoEvents.length >= 6) return false;
  if (recentDemoEvents.some((event) => event.deliveryId === deliveryId && event.kind === kind && event.createdAt >= fiveMinutesAgo)) return false;
  return true;
}

export async function POST(request: Request) {
  try {
    const session = await getCompanySession(request);
    if (!session) return json({ error: "authentication_required" }, 401);

    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== requestUrl.host) return json({ error: "Origin not allowed" }, 403);

    const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const recipient = normalizeCustomerPhone(runtimeEnv.WHATSAPP_DEMO_RECIPIENT ?? "");
    const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim();
    if (!token || !phoneNumberId || !recipient || !templateName) return json({ error: "WhatsApp demo is not configured" }, 503);

    const payload = (await request.json()) as Record<string, unknown>;
    const deliveryId = cleanText(payload.deliveryId, 32);
    const customer = cleanText(payload.customer, 80) || "TrackFleet customer";
    const destination = cleanText(payload.destination, 100);
    const trackingUrl = cleanText(payload.trackingUrl, 500);
    const kind = payload.kind === "arrival" ? "arrival" : payload.kind === "tracking" ? "tracking" : null;
    if (!kind || !/^TF-[A-Za-z0-9-]+$/.test(deliveryId) || !destination) return json({ error: "Invalid WhatsApp demo request" }, 400);

    if (kind === "tracking") {
      try {
        if (new URL(trackingUrl).host !== requestUrl.host) throw new Error("Unexpected host");
      } catch {
        return json({ error: "Invalid tracking URL" }, 400);
      }
    }
    if (!(await enforceRateLimit(deliveryId, kind))) return json({ error: "Please wait before sending another demo message" }, 429);

    const thirdValue = kind === "tracking" ? trackingUrl : `Arrived at ${destination}`;
    const response = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: customer },
              { type: "text", text: deliveryId },
              { type: "text", text: thirdValue },
            ],
          }],
        },
      }),
    });
    if (!response.ok) return json({ error: "Meta could not send the demo message" }, 502);

    recentDemoEvents.push({ deliveryId, kind, createdAt: Date.now() });
    return json({ sent: true, kind });
  } catch {
    return json({ error: "WhatsApp demo request failed" }, 500);
  }
}
