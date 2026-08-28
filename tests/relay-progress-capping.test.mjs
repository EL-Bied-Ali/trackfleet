import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { calculateRouteMetrics } from "../app/lib/route-progress.ts";

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: "brussels-abattoir-45", originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `relay-progress-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "Loading", progress: 0, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

// The Tanger Med hub's own known coordinates (route-progress.ts's hardcoded
// knownDestinations entry, resolved via string match since KnownSite itself
// has no lat/lng yet) -- a truck physically sitting right at the hub.
const vehicleAtTangerMedHub = { id: "v-hub", name: "TRK-HUB", latitude: 35.89, longitude: -5.5, speed: 0, updatedAt: Date.now() };

test("a truck reaching the Tanger Med hub shows a relay-bound delivery (Tétouan) as essentially complete, not partway through a route it will never actually finish", async () => {
  const companyId = `relay-progress-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({
    companyId, customer: "Relay client", destinationSiteId: "tetouan-cortoba-146", destination: "146 Avenue Cortoba, 93000 Tétouan, Maroc",
  }));

  const linked = await memoryStore.linkVehicle(delivery.id, companyId, vehicleAtTangerMedHub);
  assert.ok(linked);

  const events = await memoryStore.listEvents(delivery.id);
  const baseline = events.find((event) => event.type === "GPS_BASELINE");
  assert.ok(baseline, "GPS_BASELINE must be recorded on first link");
  assert.ok(baseline.progress >= 95, `expected the hub-capped baseline progress to be near 100, got ${baseline.progress}`);
});

test("without the hub cap, the same position would show meaningfully less progress -- confirming the fix actually changes the outcome, not just the destination string", () => {
  const cappedAtHub = calculateRouteMetrics(35.89, -5.5, "Oued Ghlala, Ksar Al Majaz, 93000 Tanger Med, Maroc", null, null);
  const uncappedToFinalCity = calculateRouteMetrics(35.89, -5.5, "146 Avenue Cortoba, 93000 Tétouan, Maroc", null, null);
  assert.ok(cappedAtHub.progress > uncappedToFinalCity.progress, `hub-capped progress (${cappedAtHub.progress}) should be higher than the uncapped door-to-door progress (${uncappedToFinalCity.progress}) at the same physical position`);
});

test("a delivery bound for a confirmed hub itself (not a relay-only city) is unaffected -- its own destination already is the GPS-tracked endpoint", async () => {
  const companyId = `relay-progress-test-${Date.now()}-${Math.random()}`;
  const delivery = await memoryStore.create(baseDeliveryInput({
    companyId, customer: "Hub client", destinationSiteId: "tanger-med-ksar-al-majaz", destination: "Oued Ghlala, Ksar Al Majaz, 93000 Tanger Med, Maroc",
  }));

  const linked = await memoryStore.linkVehicle(delivery.id, companyId, vehicleAtTangerMedHub);
  assert.ok(linked);
  const events = await memoryStore.listEvents(delivery.id);
  const baseline = events.find((event) => event.type === "GPS_BASELINE");
  assert.ok(baseline.progress >= 95, `a truck already at its own (non-relay) destination should show as essentially complete, got ${baseline.progress}`);
});

const sources = await Promise.all([
  readFile(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
]);

test("every store backend routes relay-limited deliveries' route/progress metrics through progressRouteDestination, not the raw delivery.destination", () => {
  for (const source of sources) {
    const occurrences = source.match(/calculateRouteMetrics\(vehicle\.latitude, vehicle\.longitude, delivery\.destination/g) ?? [];
    assert.equal(occurrences.length, 0, "no calculateRouteMetrics call should use delivery.destination directly anymore -- it must go through progressRouteDestination first");
    const progressDestinationCalls = source.match(/progressRouteDestination\(\{ destination: delivery\.destination, destinationSiteId: delivery\.destinationSiteId, explicitDestination: explicitDestination\(delivery\) \}\)/g) ?? [];
    assert.equal(progressDestinationCalls.length, 3, "expected all 3 calculateRouteMetrics call sites (applySendatrackSnapshot, linkVehicle, linkVehicleToGroup) to route through progressRouteDestination");
  }
});
