import { store } from "trackfleet-delivery-store";
import type { DeliveryRow } from "../../../lib/delivery-store.types";
import { getDispatcherSession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

const MAX_DELIVERIES_PER_PRINT = 100;

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  if (!Array.isArray(payload.deliveryIds)) return noStore({ error: "invalid_delivery_ids" }, 400);

  const deliveryIds = [...new Set(payload.deliveryIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 100))];
  if (!deliveryIds.length || deliveryIds.length > MAX_DELIVERIES_PER_PRINT) {
    return noStore({ error: "invalid_delivery_ids" }, 400);
  }

  const companyDeliveries = await store.listForCompany(session.companyId);
  const deliveryById = new Map(companyDeliveries.map((delivery) => [delivery.id, delivery]));
  const allowed = deliveryIds.map((id) => deliveryById.get(id)).filter((delivery): delivery is DeliveryRow => Boolean(delivery));
  if (allowed.length !== deliveryIds.length) return noStore({ error: "delivery_not_found" }, 404);

  await Promise.all(allowed.map((delivery) => store.recordEvent(delivery.id, "LABEL_PRINT_REQUESTED", delivery.progress)));
  return noStore({ deliveryIds: allowed.map((delivery) => delivery.id) });
}
