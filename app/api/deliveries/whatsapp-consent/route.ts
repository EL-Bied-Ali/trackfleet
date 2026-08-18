import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { whatsappConsentWithdrawn } from "../../../lib/delivery-events";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

  const deliveries = await store.listForCompany(session.companyId);
  const rows = await Promise.all(deliveries.map(async (delivery) => {
    const events = await store.listEvents(delivery.id);
    const withdrawn = whatsappConsentWithdrawn(events);
    return {
      deliveryId: delivery.id,
      customer: delivery.customer,
      contact: delivery.contact,
      optedInAt: delivery.whatsappOptInAt?.toISOString() ?? null,
      whatsappOptIn: delivery.whatsappOptIn === true && !withdrawn,
      withdrawn,
      status: delivery.status,
    };
  }));

  return Response.json({ deliveries: rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "origin_not_allowed" }, { status: 403 });

  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

  let payload: { deliveryId?: unknown };
  try {
    payload = await request.json() as { deliveryId?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return Response.json({ error: "invalid_delivery_id" }, { status: 400 });

  const deliveries = await store.listForCompany(session.companyId);
  const delivery = deliveries.find((item) => item.id === deliveryId);
  if (!delivery) return Response.json({ error: "not_found" }, { status: 404 });

  const events = await store.listEvents(delivery.id);
  if (!whatsappConsentWithdrawn(events)) {
    await store.recordEvent(delivery.id, "WHATSAPP_OPT_OUT", delivery.progress);
  }

  return Response.json({
    deliveryId: delivery.id,
    whatsappOptIn: false,
    withdrawn: true,
  }, { headers: { "cache-control": "no-store" } });
}
