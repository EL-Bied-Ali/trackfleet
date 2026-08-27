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
    sendatrackVehicleId: "old-vehicle", trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "sendatrack",
    ...overrides,
  };
}

const newVehicle = { id: "new-vehicle", name: "TR-99", latitude: 33.5, longitude: -7.6, speed: 50, updatedAt: Date.now() };

test("linkVehicleToGroup moves every parcel in the group onto the new vehicle without stripping each other -- the bug a naive per-id loop would hit", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const a = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel A" }));
  const b = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel B" }));
  const c = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel C" }));

  const updated = await memoryStore.linkVehicleToGroup([a.id, b.id, c.id], companyId, newVehicle);
  assert.equal(updated.length, 3);
  assert.ok(updated.every((delivery) => delivery.sendatrackVehicleId === "new-vehicle"));

  // The real regression this guards: a naive "call linkVehicle once per id"
  // loop would have each call unassign the vehicle from the delivery(ies)
  // the previous call in the same batch just assigned it to, since
  // linkVehicle's own safety guard only excludes the single id it was
  // called with.
  const all = await memoryStore.listForCompany(companyId);
  assert.equal(all.filter((delivery) => delivery.sendatrackVehicleId === "new-vehicle").length, 3);
});

test("linkVehicleToGroup unassigns the vehicle from an unrelated delivery outside the group, same safety guard as the single-id path", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const outsider = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Outsider", sendatrackVehicleId: "new-vehicle" }));
  const a = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel A" }));

  await memoryStore.linkVehicleToGroup([a.id], companyId, newVehicle);

  const all = await memoryStore.listForCompany(companyId);
  const outsiderAfter = all.find((delivery) => delivery.id === outsider.id);
  assert.equal(outsiderAfter?.sendatrackVehicleId, "");
});

test("linkVehicleToGroup skips a Delivered parcel in the requested group, returning only the ones actually updated", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const active = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Active" }));
  const delivered = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Delivered", status: "Delivered" }));

  const updated = await memoryStore.linkVehicleToGroup([active.id, delivered.id], companyId, newVehicle);
  assert.deepEqual(updated.map((delivery) => delivery.id).sort(), [active.id]);
});

const [page, css, linkVehicleRoute] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/link-vehicle/route.ts", import.meta.url), "utf8"),
]);

test("the link-vehicle route does the whole group as one atomic call, not a loop of the single-id path", () => {
  assert.match(linkVehicleRoute, /const bulk = Array\.isArray\(payload\.deliveryIds\);/);
  assert.match(linkVehicleRoute, /store\.linkVehicleToGroup\(deliveryIds, session\.companyId, vehicle\)/);
});

test("the group truck-reassignment control is dispatcher-only and hidden for the unassigned pseudo-group", () => {
  assert.match(page, /const \[groupTruckEditorLabel, setGroupTruckEditorLabel\] = useState<string \| null>\(null\);/);
  assert.match(page, /reassignTruckForGroup\(group\.deliveries\.map\(\(delivery\) => delivery\.id\), groupTruckEditorSelection\)/);
  assert.match(page, /company\?\.role === "dispatcher" && group\.label !== \(locale === "fr" \? "À affecter"/);
});

test("group truck reassignment styling reuses the same popover pattern as the group schedule editor", () => {
  assert.match(css, /\.group-truck-editor-wrap \{ position: relative; display: inline-block; \}/);
  assert.match(css, /\.group-truck-editor-popover \{ left: auto; right: 0; \}/);
});
