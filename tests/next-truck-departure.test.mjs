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

test("POST /api/deliveries requires nextTruckDepartureAt, matching the existing plannedArrivalAt requirement", () => {
  // Regression guard: the next-truck-departure date is a mandatory field on
  // the creation form (a dispatcher/agency employee always logs it when
  // registering a parcel), so the server must reject creation without it,
  // the same way it already rejects a missing customer/destination/truck.
  assert.match(route, /const nextTruckDepartureRaw = String\(payload\.nextTruckDepartureAt \?\? ""\)\.trim\(\);/);
  assert.match(route, /const parsedNextTruckDeparture = nextTruckDepartureRaw \? new Date\(nextTruckDepartureRaw\) : null;/);
  assert.match(route, /if \(!customer \|\| !destination \|\| !truck \|\| \(!plannedArrivalAt && !validLegacyEta\) \|\| !nextTruckDepartureAt\) \{/);
  assert.match(route, /nextTruckDepartureAt,\s*\n\s*contact,/);
});

test("idempotency payload matching includes nextTruckDepartureAt, not just plannedArrivalAt", () => {
  // Without this, replaying an idempotency key with a different departure
  // date would incorrectly be treated as the same request and silently
  // ignore the new value.
  assert.match(idempotency, /existingDeparture === requestedDeparture/);
});

test("the creation form pre-fills the next-truck-departure field from the last value used, per company/user", () => {
  assert.match(page, /const \[defaultTruckDepartureAt, setDefaultTruckDepartureAt\] = useState\(""\);/);
  assert.match(page, /setDefaultTruckDepartureAt\(saved\);/);
  assert.match(page, /name="nextTruckDepartureAt" required type="datetime-local" defaultValue=\{defaultTruckDepartureAt\}/);
});

test("a stale pre-filled departure date (today or in the past) shows a reminder to update it", () => {
  // Regression guard for the specific request: since most parcels entered
  // close together wait on the same next relay truck, the field pre-fills
  // with the last value -- but once that date has arrived, reusing it
  // silently would be wrong. This must never be computed directly in the
  // render body (an impure Date.now() call there breaks React's purity
  // rule) -- it's set from the load effect and from the submit handler.
  assert.match(page, /setTruckDepartureIsStale\(Boolean\(saved\) && new Date\(saved\)\.getTime\(\) <= Date\.now\(\)\);/);
  assert.match(page, /truckDepartureIsStale \?/);
});
