import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeManualArrivalDurationEstimates,
  resolveManualArrivalSamples,
  MANUAL_ARRIVAL_MINIMUM_SAMPLES,
  MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE,
} from "../app/lib/manual-arrival-duration.ts";

function sample(destinationSiteId, startedHoursAgo, arrivedHoursAgo) {
  const now = Date.now();
  return {
    destinationSiteId,
    startedAt: new Date(now - startedHoursAgo * 3_600_000),
    arrivedAt: new Date(now - arrivedHoursAgo * 3_600_000),
  };
}

test("computes the median duration per destination site once enough samples exist", () => {
  const estimates = computeManualArrivalDurationEstimates([
    sample("marrakech-essaouira-12", 48, 0), // 48h
    sample("marrakech-essaouira-12", 60, 12), // 48h
    sample("marrakech-essaouira-12", 72, 0), // 72h
  ]);
  const marrakech = estimates.get("marrakech-essaouira-12");
  assert.ok(marrakech);
  assert.equal(marrakech.medianHours, 48);
  assert.equal(marrakech.sampleCount, 3);
});

test("never produces an estimate below the minimum sample threshold", () => {
  assert.equal(MANUAL_ARRIVAL_MINIMUM_SAMPLES, 2);
  const oneSample = computeManualArrivalDurationEstimates([sample("agadir-zaitoune-tikiouine-103a", 48, 0)]);
  assert.equal(oneSample.has("agadir-zaitoune-tikiouine-103a"), false);
  const twoSamples = computeManualArrivalDurationEstimates([
    sample("agadir-zaitoune-tikiouine-103a", 48, 0),
    sample("agadir-zaitoune-tikiouine-103a", 50, 2),
  ]);
  assert.equal(twoSamples.get("agadir-zaitoune-tikiouine-103a")?.sampleCount, 2);
});

test("discards samples where arrival is not after the start (bad/missing data), without corrupting other sites", () => {
  const estimates = computeManualArrivalDurationEstimates([
    { destinationSiteId: "fquih-ben-salah-allal-ben-abdellah-197", startedAt: new Date("2026-08-20T10:00:00Z"), arrivedAt: new Date("2026-08-20T08:00:00Z") },
    sample("fquih-ben-salah-allal-ben-abdellah-197", 40, 0),
    sample("fquih-ben-salah-allal-ben-abdellah-197", 44, 0),
  ]);
  const estimate = estimates.get("fquih-ben-salah-allal-ben-abdellah-197");
  assert.equal(estimate?.sampleCount, 2);
});

test("keeps estimates for different destination sites independent", () => {
  const estimates = computeManualArrivalDurationEstimates([
    sample("marrakech-essaouira-12", 48, 0),
    sample("marrakech-essaouira-12", 48, 0),
    sample("agadir-zaitoune-tikiouine-103a", 96, 0),
    sample("agadir-zaitoune-tikiouine-103a", 96, 0),
  ]);
  assert.equal(estimates.get("marrakech-essaouira-12")?.medianHours, 48);
  assert.equal(estimates.get("agadir-zaitoune-tikiouine-103a")?.medianHours, 96);
});

// Casablanca hub, matches its real applied coordinates.
const hub = { hubLongitude: -7.592284, hubLatitude: 33.555565, vicinityRadiusKm: 2 };
const hubConfig = new Map([["marrakech-essaouira-12", hub]]);
const arrivedAt = new Date("2026-08-25T12:00:00Z");
const doorToDoorStart = new Date("2026-08-20T06:00:00Z");

test("resolveManualArrivalSamples measures from the last GPS position near the relay hub, not the whole door-to-door journey", () => {
  const samples = resolveManualArrivalSamples([
    {
      deliveryId: "TF-1", destinationSiteId: "marrakech-essaouira-12", arrivedAt, fallbackStartedAt: doorToDoorStart,
      positionAt: new Date("2026-08-22T09:00:00Z"), latitude: 33.555565, longitude: -7.592284, // exactly at the hub
    },
    {
      // An earlier position, further from the hub than the vicinity radius -- should be ignored.
      deliveryId: "TF-1", destinationSiteId: "marrakech-essaouira-12", arrivedAt, fallbackStartedAt: doorToDoorStart,
      positionAt: new Date("2026-08-21T09:00:00Z"), latitude: 35.858802, longitude: -5.533037, // Tanger Med, far away
    },
  ], hubConfig);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].startedAt.toISOString(), "2026-08-22T09:00:00.000Z");
  assert.equal(samples[0].arrivedAt.toISOString(), arrivedAt.toISOString());
});

test("picks the LATEST position near the hub, not just any match", () => {
  const samples = resolveManualArrivalSamples([
    { deliveryId: "TF-2", destinationSiteId: "marrakech-essaouira-12", arrivedAt, fallbackStartedAt: doorToDoorStart, positionAt: new Date("2026-08-21T09:00:00Z"), latitude: 33.5556, longitude: -7.5923 },
    { deliveryId: "TF-2", destinationSiteId: "marrakech-essaouira-12", arrivedAt, fallbackStartedAt: doorToDoorStart, positionAt: new Date("2026-08-23T15:00:00Z"), latitude: 33.5555, longitude: -7.5922 },
  ], hubConfig);
  assert.equal(samples[0].startedAt.toISOString(), "2026-08-23T15:00:00.000Z");
});

test("falls back to the door-to-door start when no GPS evidence near the hub exists, or no hub is configured for the destination", () => {
  const noEvidence = resolveManualArrivalSamples([
    { deliveryId: "TF-3", destinationSiteId: "marrakech-essaouira-12", arrivedAt, fallbackStartedAt: doorToDoorStart, positionAt: null, latitude: null, longitude: null },
  ], hubConfig);
  assert.equal(noEvidence[0].startedAt.toISOString(), doorToDoorStart.toISOString());

  const noHubConfigured = resolveManualArrivalSamples([
    { deliveryId: "TF-4", destinationSiteId: "khouribga-mohamed-vi-30", arrivedAt, fallbackStartedAt: doorToDoorStart, positionAt: new Date("2026-08-22T09:00:00Z"), latitude: 33.5556, longitude: -7.5923 },
  ], new Map());
  assert.equal(noHubConfigured[0].startedAt.toISOString(), doorToDoorStart.toISOString());
});

test("Postgres query scopes by company, joins confirmed-arrival/departure events and nearby fleet telemetry, and bounds recency", async () => {
  const source = await readFile(new URL("../app/lib/manual-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /WHERE d\.company_id = \$\{companyId\}/);
  assert.match(source, /arrival\.type = 'MANUAL_ARRIVAL_CONFIRMED'/);
  assert.match(source, /departure\.type = 'DEPARTED'/);
  assert.match(source, /COALESCE\(departure\.created_at, d\.created_at\)/);
  assert.match(source, /recency_rank <= \$\{MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE\}/);
  assert.match(source, /LEFT JOIN fleet_position_observations fpo/);
  assert.match(source, /fpo\.vehicle_id = t\.sendatrack_vehicle_id/);
  assert.equal(MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE, 10);
});

test("the relay vicinity radius is wider than the hub's precise arrival geofence, matching the NEAR_DESTINATION convention", async () => {
  const source = await readFile(new URL("../app/lib/manual-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /Math\.max\(2, hub\.arrivalRadiusKm \* 4\)/);
});
