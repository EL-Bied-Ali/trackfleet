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

test("linking a truck already assigned to another active delivery joins it there instead of evicting the delivery that already had it", async () => {
  // This used to strip Delivery A's link the moment Delivery B linked the
  // same vehicle -- correct back when one truck could only ever carry one
  // active delivery, but the group feature (built later) made "one truck,
  // several parcels" the normal, intended state. Reported live: adding one
  // more unassigned parcel to an already-multi-parcel truck via this
  // per-row action silently kicked its existing members back to unassigned
  // (with their GPS position/status still attached -- a ghost truck on the
  // map) every single time.
  const companyId = `vehicle-single-assignment-${Date.now()}`;
  const deliveryA = await memoryStore.create(baseDelivery({ companyId, customer: "Client A" }));
  const deliveryB = await memoryStore.create(baseDelivery({ companyId, customer: "Client B" }));

  const linkedA = await memoryStore.linkVehicle(deliveryA.id, companyId, vehicle);
  assert.equal(linkedA?.sendatrackVehicleId, vehicle.id);

  const linkedB = await memoryStore.linkVehicle(deliveryB.id, companyId, vehicle);
  assert.equal(linkedB?.sendatrackVehicleId, vehicle.id);

  const companyDeliveries = await memoryStore.listForCompany(companyId);
  const refreshedA = companyDeliveries.find((delivery) => delivery.id === deliveryA.id);
  assert.equal(refreshedA?.sendatrackVehicleId, vehicle.id, "Delivery A must still be on the truck it was already correctly assigned to");
  assert.equal(isUnassignedVehicle(refreshedA), false);
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

test("no store backend's single-delivery linkVehicle clears the vehicle from another active delivery anymore -- that's linkVehicleToGroup's job now", () => {
  for (const path of ["app/lib/delivery-store.postgres.ts", "app/lib/delivery-store.memory.ts", "app/lib/delivery-store.cloudflare.ts"]) {
    const source = fs.readFileSync(path, "utf8");
    const linkVehicleStart = source.indexOf("async linkVehicle(deliveryId");
    const linkVehicleToGroupStart = source.indexOf("linkVehicleToGroup(");
    assert.ok(linkVehicleStart > -1 && linkVehicleToGroupStart > linkVehicleStart, `${path} must define linkVehicle before linkVehicleToGroup`);
    const linkVehicleBody = source.slice(linkVehicleStart, linkVehicleToGroupStart);
    assert.doesNotMatch(linkVehicleBody, /id (?:<>|!=) (?:\$\{delivery\.id\}|delivery\.id)/, `${path}'s linkVehicle must not evict a sibling delivery from the same vehicle`);
  }
});

test("no store backend's linkVehicleToGroup clears the vehicle from a delivery outside the group being reassigned either -- same analogous bug as linkVehicle's, confirmed and fixed the same way", () => {
  for (const path of ["app/lib/delivery-store.postgres.ts", "app/lib/delivery-store.memory.ts", "app/lib/delivery-store.cloudflare.ts"]) {
    const source = fs.readFileSync(path, "utf8");
    const linkVehicleToGroupStart = source.indexOf("linkVehicleToGroup(");
    const updateScheduleStart = source.indexOf("updateSchedule(");
    assert.ok(linkVehicleToGroupStart > -1 && updateScheduleStart > linkVehicleToGroupStart, `${path} must define linkVehicleToGroup before updateSchedule`);
    const linkVehicleToGroupBody = source.slice(linkVehicleToGroupStart, updateScheduleStart);
    assert.doesNotMatch(linkVehicleToGroupBody, /sendatrack_vehicle_id = ''|sendatrackVehicleId: ""/, `${path}'s linkVehicleToGroup must not evict deliveries outside the group from the target vehicle`);
  }
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
