import assert from "node:assert/strict";
import test from "node:test";
import { estimateRelayArrival } from "../app/lib/relay-eta-estimate.ts";

const departure = new Date("2026-09-01T08:00:00.000Z");

test("a Tanger-relayed destination (Tanger Ville, Tétouan) estimates arrival at departure + 6 days -- the midpoint of the quoted 5-7 day window", () => {
  const result = estimateRelayArrival("tanger-ville-said-kotb-19a", departure);
  assert.equal(result?.toISOString(), "2026-09-07T08:00:00.000Z");
  const tetouan = estimateRelayArrival("tetouan-cortoba-146", departure);
  assert.equal(tetouan?.toISOString(), "2026-09-07T08:00:00.000Z");
});

test("a Casablanca-relayed destination (everywhere else in the network) estimates arrival at departure + 12 days -- the midpoint of the quoted 10-13 day window, rounded", () => {
  for (const siteId of ["sale-hay-nasser-12bis", "marrakech-essaouira-12", "agadir-zaitoune-tikiouine-103a", "khouribga-mohamed-vi-30", "fquih-ben-salah-allal-ben-abdellah-197"]) {
    const result = estimateRelayArrival(siteId, departure);
    assert.equal(result?.toISOString(), "2026-09-13T08:00:00.000Z", `expected ${siteId} to estimate departure + 12 days`);
  }
});

test("a destination with no relay hub (a direct GPS-tracked site, or the hubs themselves) has no estimate -- callers must not invent one", () => {
  assert.equal(estimateRelayArrival("brussels-abattoir-45", departure), null);
  assert.equal(estimateRelayArrival("casablanca-mohammed-vi-959", departure), null);
  assert.equal(estimateRelayArrival("tanger-med-ksar-al-majaz", departure), null);
});

test("no departure date or an unknown/invalid destination also yields no estimate", () => {
  assert.equal(estimateRelayArrival("tanger-ville-said-kotb-19a", null), null);
  assert.equal(estimateRelayArrival(null, departure), null);
  assert.equal(estimateRelayArrival("not-a-real-site", departure), null);
  assert.equal(estimateRelayArrival("tanger-ville-said-kotb-19a", new Date("invalid")), null);
});

// Requested live: once real deliveries to a specific agency have confirmed
// arrivals, that agency's own observed median should win over the fixed
// hub-wide quote (see getDepartureArrivalDurationEstimates in
// departure-arrival-duration.postgres.ts).
test("uses the learned per-agency median once it clears the minimum sample threshold, instead of the fixed hub window", () => {
  const learned = estimateRelayArrival("tanger-ville-said-kotb-19a", departure, { medianHours: 96, sampleCount: 5 });
  assert.equal(learned?.toISOString(), "2026-09-05T08:00:00.000Z"); // 96h = 4 days, not the fixed 6
});

test("ignores a learned estimate below MANUAL_ARRIVAL_MINIMUM_SAMPLES, falling back to the fixed hub window", () => {
  const tooFewSamples = estimateRelayArrival("tanger-ville-said-kotb-19a", departure, { medianHours: 96, sampleCount: 1 });
  assert.equal(tooFewSamples?.toISOString(), "2026-09-07T08:00:00.000Z"); // fixed 6-day fallback, unaffected
});

test("treats a missing (null/undefined) learned estimate exactly like the old 2-argument call -- fully backward compatible", () => {
  assert.equal(estimateRelayArrival("tanger-ville-said-kotb-19a", departure, null)?.toISOString(), "2026-09-07T08:00:00.000Z");
  assert.equal(estimateRelayArrival("tanger-ville-said-kotb-19a", departure, undefined)?.toISOString(), "2026-09-07T08:00:00.000Z");
});
