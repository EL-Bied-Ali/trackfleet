import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeManualArrivalDurationEstimates,
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

test("Postgres query scopes by company, joins the confirmed-arrival and departure events, and bounds recency", async () => {
  const source = await readFile(new URL("../app/lib/manual-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /WHERE d\.company_id = \$\{companyId\}/);
  assert.match(source, /arrival\.type = 'MANUAL_ARRIVAL_CONFIRMED'/);
  assert.match(source, /departure\.type = 'DEPARTED'/);
  assert.match(source, /COALESCE\(departure\.created_at, d\.created_at\)/);
  assert.match(source, /recency_rank <= \$\{MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE\}/);
  assert.equal(MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE, 10);
});
