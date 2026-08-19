import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/delivery-store.shared-postgres.ts", "utf8");

for (const [method, mirror] of [
  ["recordEvent", "mirrorEvent"],
  ["recordEtaObservation", "mirrorEtaObservation"],
  ["recordTripPosition", "mirrorTripPosition"],
  ["recordFleetPosition", "mirrorFleetPosition"],
]) {
  test(`${method} mirrors only after the Postgres insert succeeds`, () => {
    assert.match(source, new RegExp(`const inserted = await baseStore\\.${method}\\([^;]+;\\s*if \\(inserted\\) await ${mirror}\\(`, "s"));
  });
}

test("append mirrors are idempotent in D1", () => {
  assert.match(source, /INSERT OR IGNORE INTO delivery_events/);
  assert.match(source, /INSERT OR IGNORE INTO delivery_eta_observations/);
  assert.match(source, /INSERT OR IGNORE INTO trip_position_observations/);
  assert.match(source, /INSERT OR IGNORE INTO fleet_position_observations/);
});

test("trip upserts mirror the authoritative Postgres result", () => {
  assert.match(source, /const trip = await baseStore\.upsertTrip\(input\);\s*await mirrorTrip\(trip\);\s*return trip;/s);
  assert.match(source, /ON CONFLICT\(company_id, id\) DO UPDATE/);
});

test("D1 append failures remain best-effort", () => {
  assert.match(source, /function replicationError/);
  assert.doesNotMatch(source, /throw error/);
});
