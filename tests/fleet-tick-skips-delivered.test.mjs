import assert from "node:assert/strict";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { runFleetBusinessTick } from "../app/lib/fleet-business-tick.ts";

// Regression guard for a production incident: the automation cron tick
// reliably failed with "Too many subrequests by single Worker invocation"
// because its ETA/registration/delay pass iterated store.listForCompany's
// full result -- every delivery a company has ever created, not just active
// ones -- doing several DB round trips per delivery every single tick. A
// company's already-delivered history grows forever but needs none of that
// work, so skipping it keeps tick cost bounded to active deliveries instead
// of scaling with all-time volume.
test("a tick with only delivered deliveries does no per-delivery ETA/event work for them", async () => {
  const companyId = `fleet-tick-skip-test-${Date.now()}`;
  const now = new Date();

  const delivered = await memoryStore.create({
    customer: "Already delivered", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-old", eta: "12:00", plannedArrivalAt: new Date(now.getTime() - 3600_000),
    contact: null, recipientName: "", recipientContact: null, weightKg: 10, priceAmount: 15, priceCurrency: "MAD",
    whatsappOptIn: false, whatsappOptInAt: null, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId, trackingToken: `tok-delivered-${Date.now()}`,
    driver: "TBD", status: "Delivered", progress: 100, color: "#000",
    latitude: 33.5, longitude: -7.6, speed: 0, lastPositionAt: now, gpsSource: "simulation",
  });

  let listEtaObservationsCalls = 0;
  let recordEtaObservationCalls = 0;
  const countingStore = new Proxy(memoryStore, {
    get(target, prop) {
      const orig = target[prop];
      if (typeof orig !== "function") return orig;
      if (prop === "listEtaObservations") return (...args) => { listEtaObservationsCalls += 1; return orig.apply(target, args); };
      if (prop === "recordEtaObservation") return (...args) => { recordEtaObservationCalls += 1; return orig.apply(target, args); };
      return orig.bind(target);
    },
  });

  const snapshot = { configured: true, connected: true, vehicles: [] };
  async function observeArrivalCompletion() {
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  await runFleetBusinessTick({
    snapshot, companyId, unloadGraceMinutes: 120, store: countingStore,
    observeArrivalCompletion, observedAt: now, automationStartAt: null,
  });

  assert.equal(listEtaObservationsCalls, 0, "the delivered delivery should never reach the ETA-observation lookup");
  assert.equal(recordEtaObservationCalls, 0, "the delivered delivery should never get a new ETA observation recorded");

  const events = await memoryStore.listEvents(delivered.id);
  assert.equal(events.some((event) => event.type === "REGISTERED"), false, "a delivered parcel should not get a late REGISTERED backfill");
});
