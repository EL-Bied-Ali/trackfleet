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
