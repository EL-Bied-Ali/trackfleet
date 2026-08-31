import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

const route = fs.readFileSync("app/api/deliveries/update-schedule/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const typesFile = fs.readFileSync("app/lib/delivery-store.types.ts", "utf8");

test("the store's updateSchedule sets both dates and refuses an already-delivered delivery", async () => {
  const companyId = `update-schedule-test-${Date.now()}`;
  const delivery = await memoryStore.create({
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "__unassigned__", driver: "", status: "Loading", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-${Date.now()}`, tripId: null,
  });

  const plannedArrivalAt = new Date("2026-09-01T10:00:00Z");
  const nextTruckDepartureAt = new Date("2026-08-30T08:00:00Z");
  const updated = await memoryStore.updateSchedule(delivery.id, companyId, { plannedArrivalAt, nextTruckDepartureAt });
  assert.equal(updated?.plannedArrivalAt?.toISOString(), plannedArrivalAt.toISOString());
  assert.equal(updated?.nextTruckDepartureAt?.toISOString(), nextTruckDepartureAt.toISOString());

  const delivered = await memoryStore.create({
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", driver: "", status: "Delivered", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 100, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok2-${Date.now()}`, tripId: null,
  });
  assert.equal(await memoryStore.updateSchedule(delivered.id, companyId, { plannedArrivalAt, nextTruckDepartureAt }), null);
});

test("the DeliveryStore interface declares updateSchedule and every backend implements it", () => {
  assert.match(typesFile, /updateSchedule\(deliveryId: string, companyId: string, input: \{ plannedArrivalAt: Date \| null; nextTruckDepartureAt: Date \| null \}\): Promise<DeliveryRow \| null>;/);
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-store.memory.ts",
    "app/lib/delivery-store.shared-postgres.ts",
    "app/lib/delivery-store.cloudflare-postgres-failover.ts",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /updateSchedule/, `${path} must implement updateSchedule`);
  }
});

test("the update-schedule endpoint is dispatcher-only, same-origin protected, and treats blank dates as clearing them", () => {
  assert.match(route, /getDispatcherSession\(request\)/);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /function parseOptionalDate\(value: unknown\) \{/);
  assert.match(route, /if \(!raw\) return \{ ok: true as const, date: null \};/);
  assert.match(route, /store\.updateSchedule\(deliveryId, session\.companyId, \{/);
});

// Requested live: editing the departure date should reuse the same
// auto-estimate the creation form now offers, not let the dispatcher type an
// arbitrary arrival date directly. The route now fetches the delivery first
// (to get its destinationSiteId) and derives plannedArrivalAt from
// estimateRelayArrival, same as the create route -- a client-submitted
// plannedArrivalAt only survives as a fallback for a non-relay destination.
test("update-schedule recomputes plannedArrivalAt server-side from the delivery's own destination and the submitted departure date, not from a client-submitted arrival date", () => {
  assert.match(route, /import \{ estimateRelayArrival \} from "\.\.\/\.\.\/\.\.\/lib\/relay-eta-estimate";/);
  assert.match(route, /const existing = \(await store\.listForCompany\(session\.companyId\)\)\.find\(\(candidate\) => candidate\.id === deliveryId\);/);
  assert.match(route, /const plannedArrivalAt = estimateRelayArrival\(existing\.destinationSiteId, nextTruckDeparture\.date, learnedTransitEstimate\) \?\? submittedPlannedArrival\.date;/);
});

test("update-schedule also looks up the learned per-agency transit duration, same as the create route", () => {
  assert.match(route, /import \{ getDepartureArrivalDurationEstimates \} from "\.\.\/\.\.\/\.\.\/lib\/departure-arrival-duration\.postgres";/);
  assert.match(route, /const learnedTransitEstimate = knownSite\(existing\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true\s*\n\s*\? \(await getDepartureArrivalDurationEstimates\(session\.companyId\)\)\.get\(existing\.destinationSiteId!\) \?\? null\s*\n\s*: null;/);
});

test("editing a delivery's departure date goes through the same update-schedule endpoint, only called when the date actually changed", () => {
  // The per-row truck/date-only popover this used to describe was replaced
  // by the full edit form (see delivery-edit-mode.test.mjs) -- saveDeliveryEdits
  // calls update-schedule itself, diffed against the delivery's original
  // departure date captured when the editor opened.
  assert.match(page, /if \(editingOriginal && creationDepartureAt !== editingOriginal\.departureAt\) \{/);
  assert.match(page, /fetch\("\/api\/deliveries\/update-schedule", \{/);
});
