import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

const page = fs.readFileSync("app/page.tsx", "utf8");
const route = fs.readFileSync("app/api/deliveries/update/route.ts", "utf8");
const typesFile = fs.readFileSync("app/lib/delivery-store.types.ts", "utf8");

function baseDeliveryInput(companyId, overrides = {}) {
  return {
    customer: "Original SARL", originSiteId: "brussels-abattoir-45", originLatitude: null, originLongitude: null,
    destinationSiteId: "casablanca-mohammed-vi-959", destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "__unassigned__", driver: "", status: "Loading", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-edit-${Date.now()}-${Math.random()}`, tripId: null,
    ...overrides,
  };
}

test("the DeliveryStore interface declares updateDetails and every backend implements it", () => {
  assert.match(typesFile, /updateDetails\(deliveryId: string, companyId: string, input: DeliveryDetailsUpdateInput\): Promise<DeliveryRow \| null>;/);
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-store.memory.ts",
    "app/lib/delivery-store.shared-postgres.ts",
    "app/lib/delivery-store.cloudflare-postgres-failover.ts",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /updateDetails/, `${path} must implement updateDetails`);
  }
});

test("updateDetails overwrites the content fields and refuses an already-delivered delivery", async () => {
  const companyId = `edit-mode-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId));

  const updated = await memoryStore.updateDetails(delivery.id, companyId, {
    customer: "New Customer", contact: "+32470000000", customerEmail: "new@example.com",
    recipientName: "Bob", recipientContact: "+212600000000",
    weightKg: 12, priceAmount: 18, priceCurrency: "EUR", itemDescription: null,
    destinationSiteId: "tetouan-cortoba-146", destination: "Tétouan · Avenue Cortoba",
    destinationLatitude: 35.57, destinationLongitude: -5.37, arrivalRadiusKm: 0.5,
    plannedArrivalAt: new Date("2026-09-05T10:00:00Z"),
  });
  assert.equal(updated?.customer, "New Customer");
  assert.equal(updated?.destinationSiteId, "tetouan-cortoba-146");
  assert.equal(updated?.weightKg, 12);
  assert.equal(updated?.priceAmount, 18);

  const delivered = await memoryStore.create(baseDeliveryInput(companyId, { status: "Delivered", progress: 100, trackingToken: `tok-edit-delivered-${Date.now()}` }));
  const blocked = await memoryStore.updateDetails(delivered.id, companyId, {
    customer: "Should not apply", contact: "", customerEmail: null, recipientName: "", recipientContact: "",
    weightKg: null, priceAmount: null, priceCurrency: null, itemDescription: "x",
    destinationSiteId: "casablanca-mohammed-vi-959", destination: "Casablanca",
    destinationLatitude: null, destinationLongitude: null, arrivalRadiusKm: 0.5, plannedArrivalAt: null,
  });
  assert.equal(blocked, null, "editing an already-Delivered delivery must be refused");
});

test("the update route is dispatcher-only, same-origin protected, and blocks an already-delivered delivery", () => {
  assert.match(route, /const session = await getDispatcherSession\(request\);/);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /if \(existing\.status === "Delivered"\) return noStore\(\{ error: "delivery_already_delivered" \}, 409\);/);
});

test("the update route reuses the same validation rules as the creation route -- weight/price bounds, item description required when unweighed, and phone/email normalization", () => {
  assert.match(route, /if \(weightProvided && \(weightInput === null \|\| weightInput <= 0 \|\| weightInput > 100000\)\)/);
  assert.match(route, /if \(manualPriceProvided && \(manualPriceInput === null \|\| manualPriceInput <= 0 \|\| manualPriceInput > 1000000\)\)/);
  assert.match(route, /if \(!weightProvided && !itemDescriptionInput\) \{/);
  assert.match(route, /normalizeCustomerPhone\(contactInput\)/);
  assert.match(route, /normalizeCustomerEmail\(customerEmailInput\)/);
});

test("changing the destination recomputes plannedArrivalAt from the delivery's existing departure date, the same trusted server-side computation the creation and update-schedule routes use", () => {
  assert.match(route, /const learnedTransitEstimate = knownSite\(resolvedDestinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
  assert.match(route, /const plannedArrivalAt = estimateRelayArrival\(resolvedDestinationSiteId, existing\.nextTruckDepartureAt, learnedTransitEstimate\) \?\? existing\.plannedArrivalAt;/);
});

test("openEditModal pre-fills every field of the shared creation form from the existing delivery, and refuses to open for an already-delivered one", () => {
  assert.match(page, /function openEditModal\(delivery: Delivery\) \{\s*\n\s*if \(delivery\.status === "Delivered"\) return;/);
  assert.match(page, /setEditingOriginal\(\{ truckId: delivery\.sendatrackVehicleId \?\? "", departureAt: toDatetimeLocalValue\(delivery\.nextTruckDepartureAt\) \}\);/);
  assert.match(page, /setDefaultOriginSiteId\(delivery\.originSiteId \?\? ""\);/);
  assert.match(page, /setCreationDestinationSiteId\(delivery\.destinationSiteId \?\? ""\);/);
});

test("saving edits posts the content fields to /api/deliveries/update, then only calls link-vehicle or update-schedule if the dispatcher actually changed the truck or the departure date", () => {
  assert.match(page, /const response = await fetch\("\/api\/deliveries\/update", \{/);
  assert.match(page, /if \(editingOriginal && creationVehicleId && creationVehicleId !== editingOriginal\.truckId\) \{/);
  assert.match(page, /if \(editingOriginal && creationDepartureAt !== editingOriginal\.departureAt\) \{/);
});

test("closing the form mid-edit discards the attempt instead of writing it into the separate new-delivery draft slot", () => {
  assert.match(page, /if \(company && !editingDeliveryId\) \{/);
});

test("the origin site is shown but disabled while editing (view-only, not part of what saveDeliveryEdits submits)", () => {
  assert.match(page, /disabled=\{company\?\.role === "agency" \|\| Boolean\(editingDeliveryId\)\}/);
});
