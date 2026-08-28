import { store } from "trackfleet-delivery-store";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "../../../../lib/demo-delivery";
import { getCompanySession } from "../../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";
import { pointAtRouteFraction, routeForDestination } from "../../../../lib/route-progress";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Fixed milestones for the "Faire avancer le camion" demo-walkthrough
// button (see page.tsx) -- a demo delivery has no real truck or SENDATRACK
// feed to derive progress from, so each click just jumps to the next one.
// Stops short of 100: arrival is a separate, deliberate step (the existing
// "Confirmer l'arrivée" action, same as a real delivery), not something
// advancing progress should imply on its own.
const DEMO_PROGRESS_STAGES = [35, 70, 95];

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  if (session.role !== "dispatcher") return noStore({ error: "dispatcher_only" }, 403);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deliveryId = String(payload.deliveryId ?? "").trim();
  if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);

  const delivery = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
  if (!delivery || !delivery.customer.startsWith(DEMO_DELIVERY_CUSTOMER_PREFIX)) {
    return noStore({ error: "demo_delivery_not_found" }, 404);
  }
  if (delivery.status === "Delivered") return noStore({ error: "already_delivered" }, 400);

  const nextProgress = DEMO_PROGRESS_STAGES.find((stage) => stage > delivery.progress);
  if (!nextProgress) return noStore({ ok: true, deliveryId, unchanged: true, delivery });

  const explicitOrigin: [number, number] | null = typeof delivery.originLatitude === "number" && typeof delivery.originLongitude === "number"
    ? [delivery.originLongitude, delivery.originLatitude]
    : null;
  const explicitDestination: [number, number] | null = typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
    ? [delivery.destinationLongitude, delivery.destinationLatitude]
    : null;
  const route = routeForDestination(delivery.destination, explicitDestination, explicitOrigin);
  const [longitude, latitude] = pointAtRouteFraction(route, nextProgress / 100);

  const updated = await store.advanceDemoDelivery(deliveryId, session.companyId, {
    status: "In transit",
    progress: nextProgress,
    latitude,
    longitude,
    speed: 72,
  });
  if (!updated) return noStore({ error: "demo_delivery_not_found" }, 404);
  return noStore({ ok: true, deliveryId, delivery: updated });
}
