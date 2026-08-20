import assert from "node:assert/strict";
import test from "node:test";
import { parseBulkDeliveryCsv } from "../app/lib/bulk-delivery-import.ts";
import { deliveryIdempotencyTrackingToken } from "../app/lib/delivery-idempotency.ts";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { runFleetBusinessTick } from "../app/lib/fleet-business-tick.ts";
import { publicDeliveryView } from "../app/lib/public-delivery-view.ts";
import { publicTrackingIsActive, publicTrackingTokenIsValid } from "../app/lib/tracking-access.ts";

const companyId = "accelerated-mvp-tenant";
const otherCompanyId = "accelerated-mvp-other-tenant";
const idempotencyKey = "accelerated-import-row-1";
const baseTime = Date.now() + 60_000;
const arrivalState = new Map();

function vehicle(at, latitude, longitude, speed) {
  return {
    id: "sendatrack-vehicle-42",
    name: "TRUCK-42",
    latitude,
    longitude,
    speed,
    heading: 180,
    address: "accelerated test position",
    updatedAt: at.getTime(),
    providerAccountId: "provider-account",
    providerAccountDescription: "provider account",
    providerDeviceId: "device-42",
    providerDeviceCode: "fmb920",
  };
}

function snapshot(fix) {
  return { configured: true, connected: true, vehicles: [fix] };
}

async function observeArrivalCompletion(input) {
  const key = `${input.companyId}:${input.deliveryId}`;
  if (!input.insideArrivalZone) {
    arrivalState.delete(key);
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  const previous = arrivalState.get(key);
  const continuityBroken = !previous
    || input.observationAt.getTime() < previous.lastObservedAt.getTime()
    || input.observationAt.getTime() - previous.lastObservedAt.getTime() > 30 * 60_000;
  const arrivalSiteSince = continuityBroken ? input.observationAt : previous.arrivalSiteSince;
  arrivalState.set(key, { arrivalSiteSince, lastObservedAt: input.observationAt });
  const elapsedMinutes = (input.observationAt.getTime() - arrivalSiteSince.getTime()) / 60_000;
  if (elapsedMinutes < input.unloadGraceMinutes) {
    return { justEntered: continuityBroken, deliveredNow: false, arrivalSiteSince };
  }

  const delivery = (await memoryStore.listForCompany(input.companyId)).find((row) => row.id === input.deliveryId);
  if (!delivery || delivery.status === "Delivered") {
    return { justEntered: false, deliveredNow: false, arrivalSiteSince };
  }
  delivery.status = "Delivered";
  delivery.progress = 100;
  await memoryStore.recordEvent(delivery.id, "ARRIVED", 100);
  arrivalState.delete(key);
  return { justEntered: false, deliveredNow: true, arrivalSiteSince };
}

test("accelerated multi-tick MVP flow exercises the production business core end to end", async () => {
  const plannedArrivalAt = new Date(baseTime + 6 * 60 * 60_000);
  const csv = [
    "customer,destination,planned_arrival_at,truck,origin_site_id,destination_site_id,sendatrack_vehicle_id",
    `Client MVP,"Casablanca, MA",${plannedArrivalAt.toISOString()},TRUCK-42,brussels,casablanca,sendatrack-vehicle-42`,
  ].join("\n");
  const imported = parseBulkDeliveryCsv(csv);
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows.length, 1);

  const row = imported.rows[0];
  const trackingToken = await deliveryIdempotencyTrackingToken(companyId, idempotencyKey);
  const createOnce = async () => {
    const replay = await memoryStore.getPublic(trackingToken);
    if (replay) return { delivery: replay, idempotentReplay: true };
    const delivery = await memoryStore.create({
      customer: row.customer,
      originSiteId: row.originSiteId,
      originLatitude: 50.8503,
      originLongitude: 4.3517,
      destinationSiteId: row.destinationSiteId,
      destination: row.destination,
      destinationLatitude: 33.5731,
      destinationLongitude: -7.5898,
      arrivalRadiusKm: 0.5,
      truck: row.truck,
      driver: "",
      status: "Loading",
      eta: plannedArrivalAt.toISOString(),
      plannedArrivalAt,
      progress: 0,
      color: "#16a272",
      contact: "",
      whatsappOptIn: false,
      whatsappOptInAt: null,
      sendatrackVehicleId: row.sendatrackVehicleId,
      latitude: null,
      longitude: null,
      speed: null,
      lastPositionAt: null,
      gpsSource: "simulation",
      companyId,
      trackingToken,
      tripId: null,
    });
    return { delivery, idempotentReplay: false };
  };

  const created = await createOnce();
  const replayed = await createOnce();
  assert.equal(created.idempotentReplay, false);
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(replayed.delivery.id, created.delivery.id);
  assert.equal((await memoryStore.listForCompany(companyId)).length, 1);
  assert.equal((await memoryStore.listForCompany(otherCompanyId)).length, 0);
  assert.notEqual(
    trackingToken,
    await deliveryIdempotencyTrackingToken(otherCompanyId, idempotencyKey),
    "the same import key must not collide across tenants",
  );

  const t0 = new Date(baseTime);
  const linked = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t0, 50.8503, 4.3517, 0)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t0,
  });
  assert.equal(linked.fleetPositions, 1);
  let delivery = (await memoryStore.listForCompany(companyId))[0];
  assert.equal(delivery.sendatrackVehicleId, "sendatrack-vehicle-42");
  assert.equal(delivery.gpsSource, "sendatrack");
  assert.equal(delivery.status, "Loading");
  assert.ok(delivery.tripId);
  assert.equal((await memoryStore.listTrips(companyId))[0].status, "planned");

  const t1 = new Date(baseTime + 3 * 60 * 60_000);
  const travelling = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t1, 48.8566, 2.3522, 80)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t1,
  });
  delivery = (await memoryStore.listForCompany(companyId))[0];
  const travellingEvents = await memoryStore.listEvents(delivery.id);
  assert.equal(delivery.status, "In transit");
  assert.ok(delivery.progress > 0);
  assert.ok(travellingEvents.some((event) => event.type === "DEPARTED"));
  assert.ok(travellingEvents.some((event) => event.type === "DELAY_DETECTED"));
  assert.equal(travelling.delayEvents, 1);
  assert.equal((await memoryStore.listEtaObservations(delivery.id)).at(0)?.confidence, "medium");
  assert.equal((await memoryStore.listTrips(companyId))[0].status, "active");
  assert.ok((await memoryStore.listTripPositionsForRoute(companyId, (await memoryStore.listTrips(companyId))[0].routeTemplateId)).length >= 2);

  const t2 = new Date(baseTime + 30 * 60 * 60_000);
  const arrived = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t2, 33.5731, -7.5898, 0)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t2,
  });
  delivery = (await memoryStore.listForCompany(companyId))[0];
  assert.equal(delivery.status, "In transit");
  assert.equal(delivery.progress, 99);
  assert.equal(arrived.arrivalSiteEvents, 1);
  assert.equal(arrived.automaticCompletions, 0);

  const duplicateArrival = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t2, 33.5731, -7.5898, 0)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t2,
  });
  assert.equal(duplicateArrival.fleetPositions, 0);
  assert.equal(duplicateArrival.etaObservations, 0);
  assert.equal(duplicateArrival.arrivalSiteEvents, 0);

  const t3 = new Date(t2.getTime() + 15 * 60_000);
  const completed = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t3, 33.5731, -7.5898, 0)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t3,
  });
  delivery = (await memoryStore.listForCompany(companyId))[0];
  assert.equal(completed.automaticCompletions, 1);
  assert.equal(delivery.status, "Delivered");
  assert.equal(delivery.progress, 100);
  assert.equal((await memoryStore.listTrips(companyId))[0].status, "completed");

  const eventTypes = (await memoryStore.listEvents(delivery.id)).map((event) => event.type);
  for (const expected of ["GPS_BASELINE", "DEPARTED", "DELAY_DETECTED", "ARRIVED_AT_SITE", "ARRIVED"]) {
    assert.equal(eventTypes.filter((type) => type === expected).length, 1, `${expected} must remain idempotent`);
  }
  assert.equal((await memoryStore.listFleetPositions(companyId, "physical:truck42")).length, 4);

  assert.equal(publicTrackingTokenIsValid(trackingToken), true);
  assert.equal(publicTrackingIsActive(delivery, t3), true);
  const publicView = publicDeliveryView(delivery);
  for (const privateField of ["companyId", "contact", "driver", "trackingToken", "sendatrackVehicleId", "tripId"]) {
    assert.equal(Object.hasOwn(publicView, privateField), false, `${privateField} leaked into public tracking`);
  }

  const finalReplay = await runFleetBusinessTick({
    snapshot: snapshot(vehicle(t3, 33.5731, -7.5898, 0)),
    companyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: t3,
  });
  assert.equal(finalReplay.transitions, 0, "completed parcels must no longer be mutated by GPS ticks");
  assert.equal(finalReplay.automaticCompletions, 0);
  assert.equal((await memoryStore.listTrips(companyId))[0].status, "completed");
});

test("employee arrival confirmation completes after grace without waiting for another truck fix", async () => {
  const manualCompanyId = "accelerated-manual-arrival-tenant";
  const arrivalAt = new Date(baseTime + 40 * 60 * 60_000);
  const delivery = await memoryStore.create({
    customer: "Client agence",
    originSiteId: "brussels-abattoir-45",
    originLatitude: null,
    originLongitude: null,
    destinationSiteId: "marrakech-essaouira-12",
    destination: "Marrakech · Boulevard Essaouira",
    destinationLatitude: null,
    destinationLongitude: null,
    arrivalRadiusKm: 0.5,
    truck: "TRUCK-MANUAL",
    driver: "",
    status: "In transit",
    eta: arrivalAt.toISOString(),
    plannedArrivalAt: arrivalAt,
    progress: 95,
    color: "#16a272",
    contact: "+32470000000",
    whatsappOptIn: true,
    whatsappOptInAt: arrivalAt,
    sendatrackVehicleId: "device-manual",
    latitude: null,
    longitude: null,
    speed: null,
    lastPositionAt: null,
    gpsSource: "simulation",
    companyId: manualCompanyId,
    trackingToken: "manual-arrival-private-token-123456",
    tripId: null,
  });

  const firstObservation = await observeArrivalCompletion({
    companyId: manualCompanyId,
    deliveryId: delivery.id,
    insideArrivalZone: true,
    observationAt: arrivalAt,
    unloadGraceMinutes: 15,
  });
  assert.equal(firstObservation.justEntered, true);
  await memoryStore.recordEvent(delivery.id, "MANUAL_ARRIVAL_CONFIRMED", 95);
  await memoryStore.recordEvent(delivery.id, "ARRIVED_AT_SITE", 95);

  const completed = await runFleetBusinessTick({
    snapshot: { configured: true, connected: true, vehicles: [] },
    companyId: manualCompanyId,
    unloadGraceMinutes: 15,
    store: memoryStore,
    observeArrivalCompletion,
    observedAt: new Date(arrivalAt.getTime() + 15 * 60_000),
  });
  const updated = (await memoryStore.listForCompany(manualCompanyId))[0];
  assert.equal(completed.transitions, 0);
  assert.equal(completed.automaticCompletions, 1);
  assert.equal(updated.status, "Delivered");
  const events = (await memoryStore.listEvents(delivery.id)).map((event) => event.type);
  assert.equal(events.filter((event) => event === "MANUAL_ARRIVAL_CONFIRMED").length, 1);
  assert.equal(events.filter((event) => event === "ARRIVED_AT_SITE").length, 1);
  assert.equal(events.filter((event) => event === "ARRIVED").length, 1);
});
