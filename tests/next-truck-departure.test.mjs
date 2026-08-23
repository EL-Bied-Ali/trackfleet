import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

const route = fs.readFileSync("app/api/deliveries/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const idempotency = fs.readFileSync("app/lib/delivery-idempotency.ts", "utf8");

test("the delivery record round-trips a next-truck-departure date through the store", async () => {
  const companyId = `next-departure-test-${Date.now()}`;
  const nextTruckDepartureAt = new Date("2026-08-19T09:00:00Z");
  const delivery = await memoryStore.create({
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", driver: "", status: "Loading", eta: "12:00",
    plannedArrivalAt: new Date("2026-08-20T12:00:00Z"), nextTruckDepartureAt, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-${Date.now()}`, tripId: null,
  });
  assert.equal(delivery.nextTruckDepartureAt?.toISOString(), nextTruckDepartureAt.toISOString());

  const [reloaded] = await memoryStore.listForCompany(companyId);
  assert.equal(reloaded.nextTruckDepartureAt?.toISOString(), nextTruckDepartureAt.toISOString());
});

test("POST /api/deliveries accepts a missing plannedArrivalAt/nextTruckDepartureAt -- both moved to the table editor", () => {
  // Both dates were mandatory creation-form fields; reported as redundant to
  // re-enter per parcel (like truck assignment) and moved to a table editor
  // (see update-schedule.test.mjs) that calls the new update-schedule
  // endpoint after creation instead. Both are already handled as nullable
  // throughout delay detection, ETA estimation and tracking-link expiry.
  assert.match(route, /const nextTruckDepartureRaw = String\(payload\.nextTruckDepartureAt \?\? ""\)\.trim\(\);/);
  assert.match(route, /const parsedNextTruckDeparture = nextTruckDepartureRaw \? new Date\(nextTruckDepartureRaw\) : null;/);
  assert.match(route, /if \(!customer \|\| !destination \|\| !truck\) \{/);
  assert.doesNotMatch(route, /!plannedArrivalAt && !validLegacyEta/);
  assert.doesNotMatch(route, /\|\| !nextTruckDepartureAt\)/);
  assert.match(route, /nextTruckDepartureAt,\s*\n\s*contact,/);
});

test("idempotency payload matching includes nextTruckDepartureAt, not just plannedArrivalAt", () => {
  // Without this, replaying an idempotency key with a different departure
  // date would incorrectly be treated as the same request and silently
  // ignore the new value.
  assert.match(idempotency, /existingDeparture === requestedDeparture/);
});

test("the creation form no longer has date fields -- both are edited from the table afterward instead", () => {
  assert.doesNotMatch(page, /name="plannedArrivalAt"/);
  assert.doesNotMatch(page, /name="nextTruckDepartureAt"/);
  assert.doesNotMatch(page, /defaultTruckDepartureAt/);
  assert.doesNotMatch(page, /truckDepartureIsStale/);
  assert.doesNotMatch(page, /truckDeparturePreferenceKey/);
});
