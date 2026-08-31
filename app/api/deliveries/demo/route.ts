import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import { createTrackingToken, getCompanySession } from "../../../lib/company-auth";
import { normalizeCustomerPhone } from "../../../lib/customer-contact";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "../../../lib/demo-delivery";
import { createParcelCode } from "../../../lib/parcel-code";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Dispatcher-only quick-create for showing off a feature (e.g. the agency
// WhatsApp arrival notification) to a prospective client without going
// through the full "New delivery" form or waiting for a real truck --
// the resulting delivery is fully real (same store.create as the real
// creation route) and shows up in the destination agency's dashboard
// immediately, ready to act on. Marked with DEMO_DELIVERY_CUSTOMER_PREFIX
// so it's visually obvious and can be bulk-removed via DELETE below.
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  if (session.role !== "dispatcher") return noStore({ error: "dispatcher_only" }, 403);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const contact = normalizeCustomerPhone(String(payload.contact ?? "").trim());
  if (!contact) return noStore({ error: "contact must use an international phone format, for example +212... or +32..." }, 400);
  const destinationSiteId = String(payload.destinationSiteId ?? "").trim();
  if (!destinationSiteId) return noStore({ error: "destinationSiteId is required" }, 400);
  const originSiteIdInput = String(payload.originSiteId ?? "").trim();

  const companySites = await siteStore.listForCompany(session.companyId);
  const destinationSite = companySites.find((site) => site.id === destinationSiteId) ?? null;
  if (!destinationSite) return noStore({ error: "destination site is not available for this company" }, 400);
  const originSite = companySites.find((site) => site.id === originSiteIdInput && site.roles.includes("origin"))
    ?? companySites.find((site) => site.roles.includes("origin"))
    ?? null;

  const delivery = await store.create({
    customer: `${DEMO_DELIVERY_CUSTOMER_PREFIX}Démo TrackFleet`,
    originSiteId: originSite?.id ?? null,
    originLatitude: originSite?.latitude ?? null,
    originLongitude: originSite?.longitude ?? null,
    destinationSiteId: destinationSite.id,
    destination: destinationSite.address,
    destinationLatitude: destinationSite.latitude,
    destinationLongitude: destinationSite.longitude,
    arrivalRadiusKm: destinationSite.arrivalRadiusKm,
    truck: "Démo",
    driver: "Démo",
    status: "Loading",
    eta: "",
    plannedArrivalAt: null,
    nextTruckDepartureAt: null,
    progress: 0,
    color: "#916ed7",
    contact,
    customerEmail: null,
    recipientName: "",
    recipientContact: "",
    weightKg: null,
    priceAmount: null,
    priceCurrency: null,
    itemDescription: "Colis de démonstration",
    whatsappOptIn: true,
    whatsappOptInAt: new Date(),
    recipientWhatsappOptIn: false,
    recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "",
    latitude: originSite?.latitude ?? null,
    longitude: originSite?.longitude ?? null,
    speed: null,
    lastPositionAt: null,
    gpsSource: "simulation",
    companyId: session.companyId,
    trackingToken: createTrackingToken(),
    shipmentId: null,
    parcelCode: createParcelCode(),
  });

  return noStore({ ok: true, deliveryId: delivery.id, delivery });
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  if (session.role !== "dispatcher") return noStore({ error: "dispatcher_only" }, 403);

  const deletedCount = await store.deleteDemoDeliveries(session.companyId);
  return noStore({ ok: true, deletedCount });
}
