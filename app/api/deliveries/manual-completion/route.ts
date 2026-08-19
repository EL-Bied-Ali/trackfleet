import { completeDeliveryManually } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { getCompanySession } from "../../../lib/company-auth";
import { readJsonObject, invalidJsonResponse } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const deliveries = (await store.listForCompany(session.companyId))
    .filter((delivery) => delivery.status !== "Delivered")
    .map((delivery) => ({
      id: delivery.id,
      customer: delivery.customer,
      destination: delivery.destination,
      truck: delivery.truck,
      status: delivery.status,
      progress: delivery.progress,
    }));
  return noStore({ deliveries });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);
  if (payload.confirmDelivered !== true) return noStore({ error: "delivery_confirmation_required" }, 400);

  try {
    const completed = await completeDeliveryManually(session.companyId, deliveryId);
    if (!completed) return noStore({ error: "delivery_not_found_or_already_delivered" }, 404);
    return noStore({ ok: true, deliveryId, status: "Delivered", progress: 100 });
  } catch (error) {
    console.error("[trackfleet:deliveries] manual completion failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "manual_completion_failed" }, 500);
  }
}
