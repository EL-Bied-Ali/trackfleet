import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "../app/lib/demo-delivery.ts";

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `demo-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

test("deleteDemoDeliveries removes only [DEMO]-marked deliveries for the given company, leaving real ones untouched", async () => {
  const companyId = `demo-test-${Date.now()}-${Math.random()}`;
  const real = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Atlas Distribution" }));
  const demo = await memoryStore.create(baseDeliveryInput({ companyId, customer: `${DEMO_DELIVERY_CUSTOMER_PREFIX}Démo TrackFleet` }));

  const deletedCount = await memoryStore.deleteDemoDeliveries(companyId);
  assert.equal(deletedCount, 1);

  const remaining = await memoryStore.listForCompany(companyId);
  assert.deepEqual(remaining.map((row) => row.id), [real.id]);
  assert.equal(await memoryStore.getPublic(demo.trackingToken), null);
});

test("deleteDemoDeliveries never touches another company's demo deliveries", async () => {
  const companyA = `demo-test-a-${Date.now()}-${Math.random()}`;
  const companyB = `demo-test-b-${Date.now()}-${Math.random()}`;
  const demoInB = await memoryStore.create(baseDeliveryInput({ companyId: companyB, customer: `${DEMO_DELIVERY_CUSTOMER_PREFIX}Démo TrackFleet` }));

  const deletedCount = await memoryStore.deleteDemoDeliveries(companyA);
  assert.equal(deletedCount, 0);
  assert.notEqual(await memoryStore.getPublic(demoInB.trackingToken), null);

  await memoryStore.deleteDemoDeliveries(companyB);
});

test("deleteDemoDeliveries returns 0 and is a no-op when there is nothing to delete", async () => {
  const companyId = `demo-test-empty-${Date.now()}-${Math.random()}`;
  assert.equal(await memoryStore.deleteDemoDeliveries(companyId), 0);
});

const demoRoute = await readFile(new URL("../app/api/deliveries/demo/route.ts", import.meta.url), "utf8");

test("the demo route is dispatcher-only and same-origin protected, for both creation and cleanup", () => {
  assert.match(demoRoute, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  const dispatcherOnlyChecks = demoRoute.match(/if \(session\.role !== "dispatcher"\) return noStore\(\{ error: "dispatcher_only" \}, 403\);/g) ?? [];
  assert.equal(dispatcherOnlyChecks.length, 2, "both POST (create) and DELETE (cleanup) must be dispatcher-only");
});

test("every demo delivery is created with the DEMO_DELIVERY_CUSTOMER_PREFIX marker", () => {
  assert.match(demoRoute, /customer: `\$\{DEMO_DELIVERY_CUSTOMER_PREFIX\}/);
});

test("the demo route validates the phone number and requires a destination site", () => {
  assert.match(demoRoute, /normalizeCustomerPhone\(String\(payload\.contact/);
  assert.match(demoRoute, /if \(!destinationSiteId\) return noStore/);
});
