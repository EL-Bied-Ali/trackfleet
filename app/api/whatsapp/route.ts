import { env } from "cloudflare:workers";

type WhatsAppKind = "tracking" | "arrival";

type WhatsAppEnv = {
  DB: D1Database;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_DEMO_RECIPIENT?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
};

const runtimeEnv = env as unknown as WhatsAppEnv;
const graphApiVersion = "v25.0";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function enforceRateLimit(deliveryId: string, kind: WhatsAppKind) {
  await runtimeEnv.DB.prepare(`CREATE TABLE IF NOT EXISTS whatsapp_demo_events (
    id integer PRIMARY KEY AUTOINCREMENT,
    delivery_id text NOT NULL,
    kind text NOT NULL,
    created_at integer NOT NULL
  )`).run();

  const recent = await runtimeEnv.DB.prepare(
    "SELECT COUNT(*) AS total FROM whatsapp_demo_events WHERE created_at >= ?",
  ).bind(Date.now() - 60 * 60 * 1000).first<{ total: number }>();
  if (Number(recent?.total ?? 0) >= 6) return false;

  const duplicate = await runtimeEnv.DB.prepare(
    "SELECT COUNT(*) AS total FROM whatsapp_demo_events WHERE delivery_id = ? AND kind = ? AND created_at >= ?",
  ).bind(deliveryId, kind, Date.now() - 5 * 60 * 1000).first<{ total: number }>();
  return Number(duplicate?.total ?? 0) === 0;
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== requestUrl.host) return json({ error: "Origin not allowed" }, 403);

    const token = runtimeEnv.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = runtimeEnv.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const recipient = runtimeEnv.WHATSAPP_DEMO_RECIPIENT?.replace(/\D/g, "");
    if (!token || !phoneNumberId || !recipient) return json({ error: "WhatsApp demo is not configured" }, 503);

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
    const templateName = runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim() || "jaspers_market_order_confirmation_v1";
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

    await runtimeEnv.DB.prepare(
      "INSERT INTO whatsapp_demo_events (delivery_id, kind, created_at) VALUES (?, ?, ?)",
    ).bind(deliveryId, kind, Date.now()).run();
    return json({ sent: true, kind });
  } catch {
    return json({ error: "WhatsApp demo request failed" }, 500);
  }
}
