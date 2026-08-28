import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `delete-delivery-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

test("deleteDelivery removes the delivery and its events, leaving other deliveries for the same company untouched", async () => {
  const companyId = `delete-delivery-test-${Date.now()}-${Math.random()}`;
  const target = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Remove me" }));
  const other = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Keep me" }));
  await memoryStore.recordEvent(target.id, "GPS_BASELINE", 10);

  const deleted = await memoryStore.deleteDelivery(target.id, companyId);
  assert.equal(deleted, true);

  const remaining = await memoryStore.listForCompany(companyId);
  assert.deepEqual(remaining.map((row) => row.id), [other.id]);
  assert.equal(await memoryStore.getPublic(target.trackingToken), null);
  assert.deepEqual(await memoryStore.listEvents(target.id), []);
});

test("deleteDelivery never removes a delivery belonging to a different company", async () => {
  const companyA = `delete-delivery-test-a-${Date.now()}-${Math.random()}`;
  const companyB = `delete-delivery-test-b-${Date.now()}-${Math.random()}`;
  const deliveryInB = await memoryStore.create(baseDeliveryInput({ companyId: companyB, customer: "Belongs to B" }));

  const deleted = await memoryStore.deleteDelivery(deliveryInB.id, companyA);
  assert.equal(deleted, false);
  assert.notEqual(await memoryStore.getPublic(deliveryInB.trackingToken), null);
});

test("deleteDelivery returns false for an id that doesn't exist", async () => {
  const companyId = `delete-delivery-test-missing-${Date.now()}-${Math.random()}`;
  assert.equal(await memoryStore.deleteDelivery("TF-DOES-NOT-EXIST", companyId), false);
});

const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the deliveries DELETE route is same-origin protected, dispatcher-only, and scopes deletion to the caller's own company", () => {
  assert.match(deliveriesRoute, /export async function DELETE\(request: Request\) \{/);
  const deleteBody = deliveriesRoute.slice(deliveriesRoute.indexOf("export async function DELETE"));
  assert.match(deleteBody, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(deleteBody, /if \(session\.role !== "dispatcher"\) return Response\.json\(\{ error: "dispatcher_only" \}, \{ status: 403/);
  assert.match(deleteBody, /store\.deleteDelivery\(deliveryId, session\.companyId\)/);
});

test("the deliveries DELETE route 404s instead of silently succeeding when nothing matched", () => {
  const deleteBody = deliveriesRoute.slice(deliveriesRoute.indexOf("export async function DELETE"));
  assert.match(deleteBody, /if \(!deleted\) return Response\.json\(\{ error: "delivery_not_found" \}, \{ status: 404/);
});

test("every store backend implements deleteDelivery, scoped to a company_id match", async () => {
  const checks = [
    ["../app/lib/delivery-store.postgres.ts", /WHERE id = \$\{deliveryId\} AND company_id = \$\{companyId\}/],
    ["../app/lib/delivery-store.cloudflare.ts", /WHERE id = \? AND company_id = \? LIMIT 1`\)\.bind\(deliveryId, companyId\)/],
  ];
  for (const [path, pattern] of checks) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, pattern, `${path} must scope deleteDelivery to a company_id match`);
  }
});

test("the delete-delivery button in the table requires an explicit confirmation before calling the API, and is dispatcher-only", () => {
  assert.match(page, /async function deleteDelivery\(deliveryId: string, customer: string\) \{/);
  const functionBody = page.slice(page.indexOf("async function deleteDelivery(deliveryId: string, customer: string) {"));
  assert.match(functionBody, /if \(!window\.confirm\(confirmMessage\)\) return;/);
  assert.match(functionBody, /method: "DELETE"/);
  assert.match(page, /company\?\.role === "dispatcher" && <button type="button" className="more-button delete-delivery-button"/);
});
