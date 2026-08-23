import assert from "node:assert/strict";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { runFleetBusinessTick } from "../app/lib/fleet-business-tick.ts";

// Relay destinations (see KnownSite.finalLegTrackingUnavailable) never get a
// GPS-confirmed arrival -- the site is one our trucks never physically
// visit, CTM takes over once GPS goes stale past the confirmed hub. Rather
// than leave these waiting on a dispatcher to remember to manually confirm
// them days later, the tick now assumes CTM's relay leg takes 24h and
// completes them automatically, which also fires the customer's one and
// only "arrived" WhatsApp notification (ARRIVED_AT_SITE is in the automatic
// WhatsApp set -- see notification-policy.ts).
const relayDestinationSiteId = "marrakech-essaouira-12";
const directDestinationSiteId = "casablanca-mohammed-vi-959";

function baseDeliveryInput(companyId, overrides = {}) {
  const now = new Date();
  return {
    customer: "CTM relay test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: relayDestinationSiteId, destination: "Marrakech", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-relay", eta: "12:00", plannedArrivalAt: new Date(now.getTime() - 3600_000),
    contact: null, recipientName: "", recipientContact: null, weightKg: 10, priceAmount: 15, priceCurrency: "MAD",
    whatsappOptIn: false, whatsappOptInAt: null, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "physical:relaytruck", companyId, trackingToken: `tok-relay-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 60, color: "#000",
    latitude: 33.5, longitude: -7.6, speed: 0, lastPositionAt: now, gpsSource: "sendatrack",
    ...overrides,
  };
}

test("a relay delivery whose GPS has gone stale past the hub completes automatically after the assumed 24h CTM window, recording the customer-facing arrival event", async () => {
  const companyId = `ctm-relay-test-${Date.now()}`;
  const staleSince = new Date(Date.now() - 40 * 60_000); // 40 minutes ago -- past the 30-minute freshness threshold
  const delivery = await memoryStore.create(baseDeliveryInput(companyId, { lastPositionAt: staleSince }));

  let observedGraceMinutes = null;
  async function observeArrivalCompletion(input) {
    observedGraceMinutes = input.unloadGraceMinutes;
    return { justEntered: false, deliveredNow: true, arrivalSiteSince: staleSince };
  }

  await runFleetBusinessTick({
    snapshot: { configured: true, connected: true, vehicles: [] },
    companyId, unloadGraceMinutes: 120, store: memoryStore,
    observeArrivalCompletion, observedAt: new Date(), automationStartAt: null,
  });

  assert.equal(observedGraceMinutes, 24 * 60, "the relay grace period must be 24 hours, not the normal unloading dwell");
  const events = await memoryStore.listEvents(delivery.id);
  assert.ok(events.some((event) => event.type === "ARRIVED_AT_SITE"), "ARRIVED_AT_SITE must be recorded so the automatic WhatsApp policy picks it up");
});

test("a relay delivery still on the tracked Brussels-to-hub leg (fresh GPS) is left alone -- no premature completion or notification", async () => {
  const companyId = `ctm-relay-fresh-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId, { lastPositionAt: new Date() }));

  let observeCalled = false;
  async function observeArrivalCompletion() {
    observeCalled = true;
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  await runFleetBusinessTick({
    snapshot: { configured: true, connected: true, vehicles: [] },
    companyId, unloadGraceMinutes: 120, store: memoryStore,
    observeArrivalCompletion, observedAt: new Date(), automationStartAt: null,
  });

  assert.equal(observeCalled, false, "fresh GPS means the truck is still genuinely on the tracked corridor leg -- must not enter the relay-completion path at all");
  const events = await memoryStore.listEvents(delivery.id);
  assert.equal(events.some((event) => event.type === "ARRIVED_AT_SITE"), false);
});

test("a relay delivery with no GPS history yet (never departed) is left alone, not treated as already past the relay", async () => {
  const companyId = `ctm-relay-unassigned-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId, { lastPositionAt: null, latitude: null, longitude: null, sendatrackVehicleId: "" }));

  let observeCalled = false;
  async function observeArrivalCompletion() {
    observeCalled = true;
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  await runFleetBusinessTick({
    snapshot: { configured: true, connected: true, vehicles: [] },
    companyId, unloadGraceMinutes: 120, store: memoryStore,
    observeArrivalCompletion, observedAt: new Date(), automationStartAt: null,
  });

  assert.equal(observeCalled, false);
  const events = await memoryStore.listEvents(delivery.id);
  assert.equal(events.some((event) => event.type === "ARRIVED_AT_SITE"), false);
});

test("a normal (non-relay) delivery, even with stale GPS, always uses the normal unloading grace period -- never the 24h CTM one", async () => {
  const companyId = `ctm-relay-direct-test-${Date.now()}`;
  const staleSince = new Date(Date.now() - 40 * 60_000);
  const delivery = await memoryStore.create(baseDeliveryInput(companyId, {
    destinationSiteId: directDestinationSiteId,
    destination: "Casablanca",
    lastPositionAt: staleSince,
  }));
  // Reaches the existing manual-arrival loop, which is the only path that can
  // still call observeArrivalCompletion once SENDATRACK has no fresh vehicle
  // for it in this tick's snapshot.
  await memoryStore.recordEvent(delivery.id, "MANUAL_ARRIVAL_CONFIRMED", 90);

  let observedGraceMinutes = null;
  async function observeArrivalCompletion(input) {
    observedGraceMinutes = input.unloadGraceMinutes;
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  await runFleetBusinessTick({
    snapshot: { configured: true, connected: true, vehicles: [] },
    companyId, unloadGraceMinutes: 120, store: memoryStore,
    observeArrivalCompletion, observedAt: new Date(), automationStartAt: null,
  });

  assert.equal(observedGraceMinutes, 120, "a direct (non-relay) destination must use the normal unloading grace period, not the 24h relay one");
});
