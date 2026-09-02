import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Requested live: "the departure should stay what it was entered as, and the
// arrival should remember how long it actually took for this agency last
// time" -- computeManualArrivalDurationEstimates already provides recency-
// bounded median math (manual-arrival-duration.ts), but its existing
// Postgres query (manual-arrival-duration.postgres.ts) measures only the
// GPS-hub-to-destination leg, using GPS proximity to the hub -- not usable
// at creation/edit time, when no truck has necessarily moved yet. This is a
// separate, much cheaper query measuring the full dispatcher-entered-
// departure-to-confirmed-arrival duration instead.
test("scopes by company, joins the confirmed-arrival event against next_truck_departure_at, and bounds recency -- no GPS join needed", async () => {
  const source = await readFile(new URL("../app/lib/departure-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /WHERE d\.company_id = \$\{companyId\}/);
  assert.match(source, /arrival\.type = 'MANUAL_ARRIVAL_CONFIRMED'/);
  assert.match(source, /d\.next_truck_departure_at AS started_at/);
  assert.match(source, /AND d\.next_truck_departure_at IS NOT NULL/);
  assert.match(source, /recency_rank <= \$\{MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE\}/);
  assert.doesNotMatch(source, /fleet_position_observations/);
});

test("reuses the same shared median math as the GPS-hub-based estimate, rather than duplicating it", async () => {
  const source = await readFile(new URL("../app/lib/departure-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /import \{\s*\n\s*computeManualArrivalDurationEstimates,\s*\n\s*MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE,/);
  assert.match(source, /return computeManualArrivalDurationEstimates\(samples\);/);
});

test("skips the query entirely when no relay site is configured or no database is set up, returning an empty map instead of throwing", async () => {
  const source = await readFile(new URL("../app/lib/departure-arrival-duration.postgres.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!relaySiteIds\.length\) return new Map\(\);/);
  assert.match(source, /if \(!sql\) return new Map\(\);/);
});
