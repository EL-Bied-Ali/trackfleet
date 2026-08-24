import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { UNASSIGNED_TRUCK, isUnassignedVehicle } from "../app/lib/delivery-vehicle-choice.ts";

function baseDelivery(overrides = {}) {
  return {
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca, MA", destinationLatitude: 33.5731, destinationLongitude: -7.5898,
    arrivalRadiusKm: 0.5, truck: UNASSIGNED_TRUCK, driver: "", status: "Loading", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    trackingToken: `tok-${Date.now()}-${Math.random()}`, tripId: null,
    ...overrides,
  };
}

const vehicle = { id: "V123", name: "18799-B-2", latitude: 33.57, longitude: -7.58, speed: 40, updatedAt: Date.now() };

test("linking a truck already assigned to another active delivery transfers it instead of duplicating it", async () => {
  const companyId = `vehicle-single-assignment-${Date.now()}`;
  const deliveryA = await memoryStore.create(baseDelivery({ companyId, customer: "Client A" }));
  const deliveryB = await memoryStore.create(baseDelivery({ companyId, customer: "Client B" }));

  const linkedA = await memoryStore.linkVehicle(deliveryA.id, companyId, vehicle);
  assert.equal(linkedA?.sendatrackVehicleId, vehicle.id);

  // Same physical truck, now assigned to Delivery B -- Delivery A must lose
  // the link rather than both silently sharing V123's live GPS feed.
  const linkedB = await memoryStore.linkVehicle(deliveryB.id, companyId, vehicle);
  assert.equal(linkedB?.sendatrackVehicleId, vehicle.id);

  const [companyDeliveries] = await Promise.all([memoryStore.listForCompany(companyId)]);
  const refreshedA = companyDeliveries.find((delivery) => delivery.id === deliveryA.id);
  assert.equal(refreshedA?.sendatrackVehicleId, "");
  assert.equal(refreshedA?.truck, UNASSIGNED_TRUCK);
  assert.equal(isUnassignedVehicle(refreshedA), true);
});

test("linking a truck does not disturb a different delivery already on a different truck", async () => {
  const companyId = `vehicle-single-assignment-${Date.now()}-b`;
  const deliveryA = await memoryStore.create(baseDelivery({ companyId, customer: "Client A" }));
  const deliveryC = await memoryStore.create(baseDelivery({ companyId, customer: "Client C" }));
  const otherVehicle = { ...vehicle, id: "V999", name: "TRK-999" };

  await memoryStore.linkVehicle(deliveryA.id, companyId, vehicle);
  await memoryStore.linkVehicle(deliveryC.id, companyId, otherVehicle);

  const companyDeliveries = await memoryStore.listForCompany(companyId);
  const refreshedA = companyDeliveries.find((delivery) => delivery.id === deliveryA.id);
  assert.equal(refreshedA?.sendatrackVehicleId, vehicle.id, "unrelated truck assignment must not clear an unrelated delivery");
});

test("a completed delivery keeps its historical truck record when the same vehicle is reassigned elsewhere", async () => {
  const companyId = `vehicle-single-assignment-${Date.now()}-c`;
  const delivered = await memoryStore.create(baseDelivery({ companyId, customer: "Old client", status: "Delivered", sendatrackVehicleId: vehicle.id, truck: vehicle.name, progress: 100 }));
  const active = await memoryStore.create(baseDelivery({ companyId, customer: "New client" }));

  await memoryStore.linkVehicle(active.id, companyId, vehicle);

  const companyDeliveries = await memoryStore.listForCompany(companyId);
  const refreshedDelivered = companyDeliveries.find((item) => item.id === delivered.id);
  assert.equal(refreshedDelivered?.sendatrackVehicleId, vehicle.id, "a Delivered record is history, not a live assignment -- it must not be touched");
});

test("every store backend clears the vehicle from whichever other active delivery already held it", () => {
  for (const path of ["app/lib/delivery-store.postgres.ts", "app/lib/delivery-store.cloudflare.ts"]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /status (?:<>|!=) 'Delivered'/, `${path} must scope the reassignment clear to active deliveries`);
  }
  const postgres = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
  assert.match(postgres, /UPDATE deliveries SET sendatrack_vehicle_id = '', truck = \$\{UNASSIGNED_TRUCK\}/);
  const cloudflare = fs.readFileSync("app/lib/delivery-store.cloudflare.ts", "utf8");
  assert.match(cloudflare, /UPDATE deliveries SET sendatrack_vehicle_id = '', truck = \? WHERE company_id = \? AND sendatrack_vehicle_id = \? AND status != 'Delivered' AND id != \?/);
});

test("moving a delivery to a genuinely different truck pulls it out of its trip", async () => {
  const companyId = `vehicle-single-assignment-${Date.now()}-trip`;
  const otherVehicle = { ...vehicle, id: "V777", name: "TRK-777" };

  // Simulate a delivery already grouped into a multi-stop trip on otherVehicle.
  const delivery = await memoryStore.create(baseDelivery({
    companyId, customer: "Trip client", sendatrackVehicleId: otherVehicle.id, truck: otherVehicle.name, tripId: "trip-1",
  }));

  const moved = await memoryStore.linkVehicle(delivery.id, companyId, vehicle);
  assert.equal(moved?.sendatrackVehicleId, vehicle.id);
  assert.equal(moved?.tripId, null, "a delivery moved to a different truck no longer belongs to its old trip");
});

test("re-linking the same truck a delivery already has leaves its trip untouched", async () => {
  const companyId = `vehicle-single-assignment-${Date.now()}-notrip-change`;
  const delivery = await memoryStore.create(baseDelivery({
    companyId, customer: "Trip client", sendatrackVehicleId: vehicle.id, truck: vehicle.name, tripId: "trip-1",
  }));

  const relinked = await memoryStore.linkVehicle(delivery.id, companyId, vehicle);
  assert.equal(relinked?.tripId, "trip-1", "re-linking the same vehicle is not a reassignment, so the trip must stay intact");
});

test("every store backend detaches a delivery from its trip only when the truck is actually changing", () => {
  const postgres = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
  assert.match(postgres, /if \(delivery\.sendatrackVehicleId !== vehicle\.id\) \{\s*\n\s*await sql`UPDATE deliveries SET trip_id = NULL WHERE id = \$\{delivery\.id\} AND company_id = \$\{companyId\}`;/);
  const cloudflare = fs.readFileSync("app/lib/delivery-store.cloudflare.ts", "utf8");
  assert.match(cloudflare, /if \(delivery\.sendatrackVehicleId !== vehicle\.id\) \{\s*\n\s*statements\.push\(db\(\)\.prepare\(`UPDATE deliveries SET trip_id = NULL WHERE id = \? AND company_id = \?`\)\.bind\(delivery\.id, companyId\)\);/);
});
