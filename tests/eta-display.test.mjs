import assert from "node:assert/strict";
import test from "node:test";
import { customerEtaNote, etaExplanation } from "../app/lib/eta-display.ts";

test("explains route-history ETA with trip count", () => {
  const result = etaExplanation({ source: "route-history", confidence: "medium", historyTrips: 7 }, "fr");
  assert.equal(result.sourceLabel, "Historique de la route · 7 voyages");
  assert.equal(result.confidenceLabel, "Confiance moyenne");
});

test("explains observed pace independently from historical trip count", () => {
  const result = etaExplanation({ source: "observed-pace", confidence: "medium", historyTrips: 12 }, "en");
  assert.equal(result.sourceLabel, "Current trip GPS pace");
  assert.equal(result.confidenceLabel, "Medium confidence");
});

test("falls back safely when ETA metadata is missing", () => {
  const result = etaExplanation({}, "nl");
  assert.equal(result.sourceLabel, "ETA niet beschikbaar");
  assert.equal(result.confidenceLabel, "Betrouwbaarheid niet beschikbaar");
});

test("customer copy distinguishes route history from live GPS pace", () => {
  assert.equal(customerEtaNote({ source: "route-history", historyTrips: 7 }, "fr"), "Estimation basée sur 7 trajets précédents");
  assert.equal(customerEtaNote({ source: "observed-pace", historyTrips: 7 }, "fr"), "Estimation basée sur le trajet réel");
});

test("material delay remains the primary customer ETA note", () => {
  assert.equal(customerEtaNote({ source: "route-history", historyTrips: 7, delayMinutes: 125 }, "en"), "+2 h");
});

test("an untracked final leg overrides even a material delay note, since the delay figure would be meaningless, and names CTM as the relay carrier with a ~24h fallback", () => {
  assert.equal(customerEtaNote({ source: "route-history", historyTrips: 7, delayMinutes: 125, finalLegTrackingUnavailable: true }, "en"), "CTM has taken over for this leg · arrival expected within ~24h");
  assert.equal(customerEtaNote({ source: "observed-pace", finalLegTrackingUnavailable: true }, "fr"), "La CTM a pris le relais pour cette étape · arrivée prévue sous ~24 h");
  assert.equal(customerEtaNote({ finalLegTrackingUnavailable: true }, "nl"), "CTM heeft dit traject overgenomen · aankomst verwacht binnen ~24u");
});

test("dispatcher ETA explanation also flags an untracked final leg as a CTM relay instead of a stale confidence label", () => {
  const result = etaExplanation({ source: "observed-pace", confidence: "medium", finalLegTrackingUnavailable: true }, "fr");
  assert.equal(result.sourceLabel, "Relais CTM · ~24 h");
  assert.equal(result.confidenceLabel, "");
});

test("an untracked final leg with enough employee-confirmed arrivals shows a rough duration estimate instead of the bare ~24h fallback", () => {
  assert.equal(
    customerEtaNote({ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: 48, manualArrivalEstimateSampleCount: 6, delayMinutes: 125 }, "en"),
    "CTM has taken over for this leg · usually about 2 days (based on 6 previous deliveries)",
  );
  assert.equal(
    customerEtaNote({ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: 6, manualArrivalEstimateSampleCount: 1 }, "en"),
    "CTM has taken over for this leg · arrival expected within ~24h",
    "one sample is below the minimum -- must not present it as a reliable estimate",
  );
  assert.equal(
    customerEtaNote({ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: 6, manualArrivalEstimateSampleCount: 3 }, "fr"),
    "La CTM a pris le relais pour cette étape · généralement environ 6 h (3 livraisons précédentes)",
  );
});

test("the dispatcher ETA explanation shows the same duration estimate with a sample-count confidence label", () => {
  const result = etaExplanation({ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: 30, manualArrivalEstimateSampleCount: 4 }, "en");
  assert.equal(result.sourceLabel, "CTM relay · ~1 day");
  assert.equal(result.confidenceLabel, "Based on 4 confirmed arrivals");
});
