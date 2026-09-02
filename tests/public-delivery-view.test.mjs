import test from "node:test";
import assert from "node:assert/strict";
import { publicDeliveryView } from "../app/lib/public-delivery-view.ts";

const source = {
  id: "DEL-1",
  companyId: "company-secret",
  customer: "Customer",
  contact: "+32000000000",
  whatsappOptIn: true,
  whatsappOptInAt: new Date("2026-08-20T00:00:00.000Z"),
  destination: "Tanger Med",
  destinationSiteId: "tanger-med-ksar-al-majaz",
  weightKg: 12.5,
  priceAmount: 450,
  priceCurrency: "MAD",
  itemDescription: "Washing machine",
  destinationLatitude: 35.858923,
  destinationLongitude: -5.532664,
  arrivalRadiusKm: 0.5,
  truck: "18799-B-2",
  driver: "Private Driver",
  status: "In transit",
  eta: "12:00",
  plannedArrivalAt: new Date("2026-08-20T12:00:00.000Z"),
  progress: 50,
  latitude: 35.7,
  longitude: -5.6,
  speed: 70,
  lastPositionAt: new Date("2026-08-20T10:00:00.000Z"),
  trackingToken: "AbCdEf0123456789_-xyZ123",
  sendatrackVehicleId: "provider-secret-id",
  tripId: "trip-private",
  routeDistanceKm: 100,
  remainingDistanceKm: 50,
  distanceToDestinationKm: 50,
  positionAgeMinutes: 2,
  gpsFresh: true,
  estimatedArrivalAt: "2026-08-20T12:00:00.000Z",
  etaDelayMinutes: 0,
  etaConfidence: "medium",
  etaSource: "observed-pace",
  effectiveSpeedKmh: 65,
  etaHistoryTrips: 4,
  etaHistoricalSpeedKmh: 62,
  trackingExpiresAt: "2026-08-27T12:00:00.000Z",
  manualArrivalEstimateHours: 48.5,
  manualArrivalEstimateSampleCount: 6,
};

test("public delivery view exposes only the customer tracking allow-list", () => {
  const publicView = publicDeliveryView(source);
  assert.deepEqual(Object.keys(publicView).sort(), [
    "arrivalRadiusKm",
    "customer",
    "destination",
    "destinationLatitude",
    "destinationLongitude",
    "destinationSiteId",
    "destinationWhatsapp",
    "distanceToDestinationKm",
    "effectiveSpeedKmh",
    "estimatedArrivalAt",
    "eta",
    "etaConfidence",
    "etaDelayMinutes",
    "etaHistoricalSpeedKmh",
    "etaHistoryTrips",
    "etaSource",
    "gpsFresh",
    "id",
    "itemDescription",
    "lastPositionAt",
    "latitude",
    "longitude",
    "manualArrivalEstimateHours",
    "manualArrivalEstimateSampleCount",
    "plannedArrivalAt",
    "positionAgeMinutes",
    "priceAmount",
    "priceCurrency",
    "progress",
    "remainingDistanceKm",
    "routeDistanceKm",
    "speed",
    "status",
    "trackingExpiresAt",
    "truck",
    "weightKg",
  ].sort());

  for (const forbidden of [
    "companyId",
    "contact",
    "whatsappOptIn",
    "whatsappOptInAt",
    "driver",
    "trackingToken",
    "sendatrackVehicleId",
    "tripId",
  ]) {
    assert.equal(Object.hasOwn(publicView, forbidden), false, `${forbidden} must stay private`);
  }
});

// The destination agency's own WhatsApp number: caller-supplied (the route
// only passes it once the delivery is genuinely Delivered), never read off
// the delivery row itself -- the row has no such field, only sites do.
test("destinationWhatsapp defaults to null when the caller doesn't supply one", () => {
  const publicView = publicDeliveryView(source);
  assert.equal(publicView.destinationWhatsapp, null);
});

test("destinationWhatsapp passes through whatever the caller supplies", () => {
  const publicView = publicDeliveryView(source, { destinationWhatsapp: "+212 6 62 72 53 29" });
  assert.equal(publicView.destinationWhatsapp, "+212 6 62 72 53 29");
});
