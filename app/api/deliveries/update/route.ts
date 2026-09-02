import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { normalizeCustomerEmail, normalizeCustomerPhone } from "../../../lib/customer-contact";
import { computeDeliveryPrice, deliveryPriceCurrencyForOriginCountry } from "../../../lib/delivery-pricing";
import { findCompanySiteByText, resolveExplicitCompanySite } from "../../../lib/delivery-site-resolution";
import { getDepartureArrivalDurationEstimates } from "../../../lib/departure-arrival-duration.postgres";
import { knownSite, resolveKnownSite } from "../../../lib/known-sites";
import { estimateRelayArrival } from "../../../lib/relay-eta-estimate";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Edits the "content" fields of an existing delivery -- everything the full
// creation form can set except truck/vehicle and next departure date, which
// keep using their own dedicated, already-hardened routes (link-vehicle,
// update-schedule) rather than being folded into this one. Reuses the same
// validation/computation rules as POST /api/deliveries (customer.ts contact
// normalization, price-from-weight, relay ETA estimation), just applied to
// an existing row instead of a brand-new one.
export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return originRejectedResponse();
    const session = await getDispatcherSession(request);
    if (!session) return noStore({ error: "unauthorized" }, 401);

    const payload = await readJsonObject(request);
    if (!payload) return invalidJsonResponse();

    const deliveryId = String(payload.deliveryId ?? "").trim();
    if (!deliveryId || deliveryId.length > 100) return noStore({ error: "invalid_delivery_id" }, 400);

    const customer = String(payload.customer ?? "").trim();
    const destinationInput = String(payload.destination ?? "").trim();
    const destinationSiteId = String(payload.destinationSiteId ?? "").trim();
    const contactInput = String(payload.contact ?? "").trim();
    const customerEmailInput = String(payload.customerEmail ?? "").trim();
    const recipientName = String(payload.recipientName ?? "").trim();
    const recipientContactInput = String(payload.recipientContact ?? "").trim();
    const weightProvided = payload.weightKg !== null && payload.weightKg !== undefined && String(payload.weightKg).trim() !== "";
    const weightInput = optionalNumber(payload.weightKg);
    const manualPriceProvided = payload.manualPriceAmount !== null && payload.manualPriceAmount !== undefined && String(payload.manualPriceAmount).trim() !== "";
    const manualPriceInput = optionalNumber(payload.manualPriceAmount);
    const itemDescriptionInput = String(payload.itemDescription ?? "").trim();
    const paymentStatusInput = String(payload.paymentStatus ?? "unpaid").trim();
    const amountPaidInput = optionalNumber(payload.amountPaid);

    if (
      customer.length > 160 || destinationInput.length > 500 || destinationSiteId.length > 100
      || contactInput.length > 40 || customerEmailInput.length > 254
      || recipientName.length > 160 || recipientContactInput.length > 40 || itemDescriptionInput.length > 200
    ) {
      return noStore({ error: "delivery fields exceed allowed length" }, 400);
    }
    if (weightProvided && (weightInput === null || weightInput <= 0 || weightInput > 100000)) {
      return noStore({ error: "weightKg must be greater than 0 and at most 100000" }, 400);
    }
    if (manualPriceProvided && (manualPriceInput === null || manualPriceInput <= 0 || manualPriceInput > 1000000)) {
      return noStore({ error: "manualPriceAmount must be greater than 0 and at most 1000000" }, 400);
    }
    if (!["unpaid", "partial", "paid"].includes(paymentStatusInput)) {
      return noStore({ error: "paymentStatus must be one of unpaid, partial, paid" }, 400);
    }
    if (paymentStatusInput === "partial" && (amountPaidInput === null || amountPaidInput <= 0)) {
      return noStore({ error: "amountPaid must be greater than 0 when paymentStatus is partial" }, 400);
    }
    if (!weightProvided && !itemDescriptionInput) {
      return noStore({ error: "itemDescription is required when weightKg is not provided" }, 400);
    }
    if (!customer || !destinationSiteId) {
      return noStore({ error: "customer and destinationSiteId are required" }, 400);
    }
    const weightKg = weightInput === null ? null : Math.round(weightInput * 1000) / 1000;

    const contact = normalizeCustomerPhone(contactInput);
    if (contact === null) return noStore({ error: "contact must use an international phone format, for example +212... or +32..." }, 400);
    const customerEmail = normalizeCustomerEmail(customerEmailInput);
    if (customerEmail === null) return noStore({ error: "customerEmail must be a valid email address" }, 400);
    const recipientContact = normalizeCustomerPhone(recipientContactInput);
    if (recipientContact === null) return noStore({ error: "recipientContact must use an international phone format, for example +212... or +32..." }, 400);
    if (Boolean(recipientName) !== Boolean(recipientContact)) {
      return noStore({ error: "recipientName and recipientContact must be provided together" }, 400);
    }

    const existing = (await store.listForCompany(session.companyId)).find((candidate) => candidate.id === deliveryId);
    if (!existing) return noStore({ error: "delivery_not_found" }, 404);
    if (existing.status === "Delivered") return noStore({ error: "delivery_already_delivered" }, 409);

    const companySites = await siteStore.listForCompany(session.companyId);
    const destinationSelection = resolveExplicitCompanySite(companySites, destinationSiteId);
    if (destinationSelection.invalid) return noStore({ error: "destination site is not available for this company" }, 400);
    const site = destinationSelection.site ?? findCompanySiteByText(companySites, destinationInput) ?? resolveKnownSite(destinationInput);
    const destination = site?.address ?? destinationInput;

    // Origin doesn't change in edit mode -- reused only to pick the right
    // price-per-kg currency, same as the creation route does with the
    // freshly-chosen origin.
    const originSite = existing.originSiteId ? companySites.find((candidate) => candidate.id === existing.originSiteId) ?? null : null;
    // Same override precedence as creation (route.ts) -- price is fully
    // editable, a dispatcher-entered manualPriceAmount wins over the
    // weight-derived figure whenever it's explicitly present.
    const { priceAmount, priceCurrency } = manualPriceInput !== null && manualPriceInput > 0
      ? { priceAmount: Math.round(manualPriceInput * 100) / 100, priceCurrency: deliveryPriceCurrencyForOriginCountry(originSite?.country ?? null) }
      : weightKg !== null
        ? computeDeliveryPrice(weightKg, originSite?.country ?? null)
        : { priceAmount: null, priceCurrency: null };
    if (paymentStatusInput === "partial" && priceAmount !== null && amountPaidInput !== null && amountPaidInput >= priceAmount) {
      return noStore({ error: "amountPaid must be less than the delivery's price for a partial payment -- use paymentStatus 'paid' instead" }, 400);
    }
    const amountPaid = paymentStatusInput === "partial" ? amountPaidInput : null;

    const requestedDestinationLatitude = optionalNumber(payload.destinationLatitude);
    const requestedDestinationLongitude = optionalNumber(payload.destinationLongitude);
    if ((requestedDestinationLatitude === null) !== (requestedDestinationLongitude === null)) {
      return noStore({ error: "destinationLatitude and destinationLongitude must be provided together" }, 400);
    }
    const destinationLatitude = requestedDestinationLatitude ?? site?.latitude ?? null;
    const destinationLongitude = requestedDestinationLongitude ?? site?.longitude ?? null;
    if (destinationLatitude !== null && (destinationLatitude < -90 || destinationLatitude > 90 || destinationLongitude! < -180 || destinationLongitude! > 180)) {
      return noStore({ error: "invalid destination coordinates" }, 400);
    }
    const requestedRadius = optionalNumber(payload.arrivalRadiusKm);
    const arrivalRadiusKm = Math.max(0.05, Math.min(10, requestedRadius ?? site?.arrivalRadiusKm ?? 0.5));

    // Same trusted, never-client-supplied ETA computation the creation route
    // and update-schedule use -- a destination change has to recompute this
    // from the (possibly new) destination's relay window, using the
    // delivery's existing departure date (editing that date has its own
    // dedicated update-schedule route/action).
    const resolvedDestinationSiteId = site?.id ?? destinationSiteId;
    const learnedTransitEstimate = knownSite(resolvedDestinationSiteId)?.finalLegTrackingUnavailable === true
      ? (await getDepartureArrivalDurationEstimates(session.companyId)).get(resolvedDestinationSiteId) ?? null
      : null;
    const plannedArrivalAt = estimateRelayArrival(resolvedDestinationSiteId, existing.nextTruckDepartureAt, learnedTransitEstimate) ?? existing.plannedArrivalAt;

    const updated = await store.updateDetails(deliveryId, session.companyId, {
      customer, contact, customerEmail: customerEmail || null, recipientName, recipientContact,
      weightKg, priceAmount, priceCurrency, paymentStatus: paymentStatusInput as "unpaid" | "partial" | "paid", amountPaid, itemDescription: itemDescriptionInput || null,
      destinationSiteId: resolvedDestinationSiteId, destination, destinationLatitude, destinationLongitude, arrivalRadiusKm,
      plannedArrivalAt,
    });
    if (!updated) return noStore({ error: "delivery_not_found_or_already_delivered" }, 404);
    return noStore({ delivery: updated });
  } catch (error) {
    console.error("[trackfleet:deliveries] update failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "update_failed" }, 500);
  }
}
