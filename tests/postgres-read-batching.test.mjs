import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const postgresBatchPath = new URL("../app/lib/delivery-store.postgres-read-batches.ts", import.meta.url);
const sharedStorePath = new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("event history uses one ANY query for many delivery ids", async () => {
  const code = await source(postgresBatchPath);
  assert.match(code, /delivery_id\s*=\s*ANY\(\$\{deliveryIds\}::text\[\]\)/);
  assert.doesNotMatch(code, /for\s*\([^)]*deliveryIds[^)]*\)[\s\S]*await\s+sql/);
});

test("ETA history applies a per-delivery row_number limit in one query", async () => {
  const code = await source(postgresBatchPath);
  assert.match(code, /row_number\(\)\s+OVER\s*\(PARTITION BY delivery_id ORDER BY position_at DESC\)/i);
  assert.match(code, /WHERE row_number <= \$\{capped\}/);
  assert.match(code, /delivery_id\s*=\s*ANY\(\$\{deliveryIds\}::text\[\]\)/);
});

test("shared Postgres store overrides only read methods with batchers", async () => {
  const code = await source(sharedStorePath);
  assert.match(code, /\.\.\.baseStore/);
  assert.match(code, /listEvents:\s*listEventsBatched/);
  assert.match(code, /listEtaObservations:\s*listEtaObservationsBatched/);
  assert.doesNotMatch(code, /listEtaObservationsForRoute:\s*/);
});
