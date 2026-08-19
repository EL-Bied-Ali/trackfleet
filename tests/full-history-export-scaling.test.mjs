import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fullStoreUrl = new URL("../app/lib/delivery-store.full-shared-postgres.ts", import.meta.url);
const exportRouteUrl = new URL("../app/api/operations/export/route.ts", import.meta.url);
const operationalStoreUrl = new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url);

test("full-history store preserves complete delivery listing but batches event and ETA reads", async () => {
  const source = await readFile(fullStoreUrl, "utf8");
  assert.match(source, /store as baseStore/);
  assert.match(source, /\.\.\.baseStore/);
  assert.doesNotMatch(source, /listForCompany:\s*loadOperationalDeliveries/);
  assert.match(source, /loadEventBatch/);
  assert.match(source, /loadEtaBatch/);
  assert.match(source, /listEvents:\s*listEventsBatched/);
  assert.match(source, /listEtaObservations:\s*listEtaObservationsBatched/);
});

test("tenant export explicitly uses the full-history store and parallel event reads can coalesce", async () => {
  const source = await readFile(exportRouteUrl, "utf8");
  assert.match(source, /trackfleet-delivery-store-full/);
  assert.match(source, /Promise\.all\(deliveries\.map\(\(delivery\) => store\.listEvents\(delivery\.id\)\)\)/);
});

test("operational and full-history stores share the same batching primitives", async () => {
  const [full, operational] = await Promise.all([
    readFile(fullStoreUrl, "utf8"),
    readFile(operationalStoreUrl, "utf8"),
  ]);
  for (const primitive of ["createRecordBatcher", "createLimitedArrayBatcher", "loadEventBatch", "loadEtaBatch"]) {
    assert.ok(full.includes(primitive), `full-history store is missing ${primitive}`);
    assert.ok(operational.includes(primitive), `operational store is missing ${primitive}`);
  }
});
