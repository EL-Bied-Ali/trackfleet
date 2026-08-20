import assert from "node:assert/strict";
import test from "node:test";
import { arrivalConfirmationRecommendation } from "../app/lib/arrival-confirmation.ts";
import { knownSites } from "../app/lib/known-sites.ts";
import { isAutomaticWhatsAppEvent } from "../app/lib/notification-policy.ts";
import { automaticWhatsAppMessage } from "../app/lib/whatsapp-message.ts";

const expectedAgencyIds = [
  "brussels-abattoir-45",
  "tanger-med-ksar-al-majaz",
  "tanger-ville-said-kotb-19a",
  "tetouan-cortoba-146",
  "sale-hay-nasser-12bis",
  "marrakech-essaouira-12",
  "agadir-zaitoune-tikiouine-103a",
  "khouribga-mohamed-vi-30",
  "fquih-ben-salah-allal-ben-abdellah-197",
  "casablanca-mohammed-vi-959",
];

test("registration and arrival WhatsApp business messages cover every agency", () => {
  const agencies = knownSites.filter((site) => site.roles.includes("destination"));
  assert.deepEqual(agencies.map((site) => site.id), expectedAgencyIds);
  assert.equal(new Set(agencies.map((site) => site.id)).size, expectedAgencyIds.length);
  assert.equal(isAutomaticWhatsAppEvent("REGISTERED"), true);
  assert.equal(isAutomaticWhatsAppEvent("ARRIVED_AT_SITE"), true);
  assert.equal(isAutomaticWhatsAppEvent("ARRIVED"), false, "unloading completion must not duplicate the arrival message");

  for (const [index, agency] of agencies.entries()) {
    const delivery = { id: `TF-AGENCY-${index + 1}`, destination: agency.label };
    const trackingUrl = `https://trackfleet.example/?tracking=private-${index + 1}`;
    const registered = automaticWhatsAppMessage("REGISTERED", delivery, trackingUrl);
    const arrived = automaticWhatsAppMessage("ARRIVED_AT_SITE", delivery, trackingUrl);
    assert.match(registered, new RegExp(delivery.id));
    assert.ok(registered.includes(agency.label));
    assert.ok(registered.includes(trackingUrl));
    assert.match(arrived, new RegExp(delivery.id));
    assert.ok(arrived.includes(agency.label));
  }
});

test("every unpinned agency recommends a human arrival confirmation only when plausible", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  for (const agency of knownSites) {
    assert.equal(agency.latitude, null, `${agency.id} still needs an exact entrance latitude`);
    assert.equal(agency.longitude, null, `${agency.id} still needs an exact entrance longitude`);
    const base = {
      status: "In transit",
      plannedArrivalAt: new Date("2026-08-20T11:30:00.000Z"),
      progress: 95,
      destinationLatitude: agency.latitude,
      destinationLongitude: agency.longitude,
      gpsSource: "sendatrack",
      latitude: 33.5,
      longitude: -7.6,
      lastPositionAt: new Date("2026-08-20T11:59:00.000Z"),
      events: [],
      now,
    };
    assert.deepEqual(arrivalConfirmationRecommendation(base), {
      state: "manual_recommended",
      reason: "destination_coordinates_missing",
    });
    assert.deepEqual(arrivalConfirmationRecommendation({ ...base, progress: 50, plannedArrivalAt: new Date("2026-08-20T15:00:00.000Z") }), {
      state: "automatic_pending",
      reason: "in_transit",
    });
  }
});

test("manual and automatic arrival confirmations are stable and unambiguous", () => {
  const base = {
    status: "In transit",
    progress: 99,
    plannedArrivalAt: null,
    destinationLatitude: null,
    destinationLongitude: null,
    gpsSource: "simulation",
    latitude: null,
    longitude: null,
    lastPositionAt: null,
  };
  assert.deepEqual(arrivalConfirmationRecommendation({ ...base, events: [{ type: "MANUAL_ARRIVAL_CONFIRMED" }] }), {
    state: "manual_confirmed",
    reason: "manual_already_confirmed",
  });
  assert.deepEqual(arrivalConfirmationRecommendation({ ...base, events: [{ type: "ARRIVED_AT_SITE" }] }), {
    state: "automatic_confirmed",
    reason: "gps_arrival_detected",
  });
});
