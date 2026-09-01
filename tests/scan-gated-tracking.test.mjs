import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// This business has no mid-route pickups: a delivery only starts being
// tracked on its assigned truck (GPS baseline captured, progress/status
// updated) once the parcel has actually been scanned "chargé" onto it,
// regardless of which UI path assigned the truck (automation tick,
// per-row link, or group link). See app/api/deliveries/route.ts and
// delivery-store.{memory,postgres,cloudflare}.ts for the matching creation
// and store-side changes -- and the 2026-09-01 memory entry for the
// "y'a pas de ramassage en cours de route" conversation that drove this.

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: "brussels-abattoir-45", originLatitude: 50.8503, originLongitude: 4.3517,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `scan-gate-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "Loading", progress: 0, color: "#000",
    latitude: 50.8503, longitude: 4.3517, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

const movingVehicle = { id: "v-1", name: "TRUCK-1", latitude: 45.0, longitude: 3.0, speed: 80, updatedAt: Date.now() };

test("applySendatrackSnapshot does not link a delivery to its matched truck until the parcel has been scanned loaded", async () => {
  const companyId = `scan-gate-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({ companyId, sendatrackVehicleId: movingVehicle.id, truck: movingVehicle.name }));

  const transitions = await memoryStore.applySendatrackSnapshot({ configured: true, connected: true, vehicles: [movingVehicle] }, companyId);
  assert.equal(transitions.length, 0, "an unscanned delivery must not be linked/tracked by the automation tick");

  const untouched = (await memoryStore.listForCompany(companyId)).find((row) => row.id === delivery.id);
  assert.equal(untouched.gpsSource, "simulation");
  assert.equal(untouched.progress, 0);
  assert.equal(untouched.status, "Loading");
});

test("applySendatrackSnapshot links normally on the next tick once the parcel is scanned loaded", async () => {
  const companyId = `scan-gate-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({ companyId, sendatrackVehicleId: movingVehicle.id, truck: movingVehicle.name }));

  await memoryStore.applySendatrackSnapshot({ configured: true, connected: true, vehicles: [movingVehicle] }, companyId);
  await memoryStore.recordEvent(delivery.id, "SCAN_LOADED", 0);
  const transitions = await memoryStore.applySendatrackSnapshot({ configured: true, connected: true, vehicles: [movingVehicle] }, companyId);

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].delivery.gpsSource, "sendatrack");
  const events = await memoryStore.listEvents(delivery.id);
  assert.ok(events.some((event) => event.type === "GPS_BASELINE"), "linking after a scan must still capture the baseline, same as before");
});

test("applySendatrackSnapshot never retroactively freezes a delivery that was already tracking before this rule existed", async () => {
  const companyId = `scan-gate-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({
    companyId, sendatrackVehicleId: movingVehicle.id, truck: movingVehicle.name, gpsSource: "sendatrack",
  }));
  await memoryStore.recordEvent(delivery.id, "GPS_BASELINE", 10);

  const transitions = await memoryStore.applySendatrackSnapshot({ configured: true, connected: true, vehicles: [movingVehicle] }, companyId);
  assert.equal(transitions.length, 1, "a delivery already tracking must keep updating even without a SCAN_LOADED event on file");
});

test("linkVehicle assigns the truck immediately but withholds GPS tracking until scanned loaded", async () => {
  const companyId = `scan-gate-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({ companyId }));

  const linked = await memoryStore.linkVehicle(delivery.id, companyId, movingVehicle);
  assert.equal(linked.sendatrackVehicleId, movingVehicle.id, "the truck assignment itself must always go through");
  assert.equal(linked.truck, movingVehicle.name);
  assert.equal(linked.gpsSource, "simulation", "no GPS tracking starts before the parcel is scanned loaded");
  assert.equal(linked.latitude, delivery.latitude, "position must not jump to the truck's live location before scan");
  const events = await memoryStore.listEvents(delivery.id);
  assert.ok(!events.some((event) => event.type === "GPS_BASELINE"), "no baseline should be captured before scan");

  await memoryStore.recordEvent(delivery.id, "SCAN_LOADED", 0);
  const relinked = await memoryStore.linkVehicle(delivery.id, companyId, movingVehicle);
  assert.equal(relinked.gpsSource, "sendatrack", "re-linking after the scan starts tracking normally");
});

test("linkVehicleToGroup applies the same scan gate per delivery, independently, across a group", async () => {
  const companyId = `scan-gate-test-${Date.now()}-${Math.random()}`;
  const scannedDelivery = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Scanned" }));
  const unscannedDelivery = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Unscanned" }));
  await memoryStore.recordEvent(scannedDelivery.id, "SCAN_LOADED", 0);

  const linked = await memoryStore.linkVehicleToGroup([scannedDelivery.id, unscannedDelivery.id], companyId, movingVehicle);
  const scannedResult = linked.find((delivery) => delivery.id === scannedDelivery.id);
  const unscannedResult = linked.find((delivery) => delivery.id === unscannedDelivery.id);

  assert.equal(scannedResult.gpsSource, "sendatrack");
  assert.equal(unscannedResult.gpsSource, "simulation");
  assert.equal(unscannedResult.sendatrackVehicleId, movingVehicle.id, "still assigned, just not yet tracked");
});

test("a brand-new delivery never captures the assigned truck's live GPS position as its own creation-time baseline", async () => {
  const source = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /baselineMetrics/, "creation-time baseline capture must be fully removed, not just unused");
  assert.match(source, /gpsSource: "simulation",\s*\n\s*\}\);/, "a new delivery must always start with gpsSource: \"simulation\", regardless of the selected truck's live state");
});

const sources = await Promise.all([
  readFile(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
]);

test("every store backend gates the very first GPS link on a recorded SCAN_LOADED event", () => {
  for (const source of sources) {
    assert.match(source, /SCAN_LOADED/, "each backend must check for a SCAN_LOADED event before starting tracking");
  }
});
