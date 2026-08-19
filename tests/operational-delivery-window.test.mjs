import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operationalSource = new URL("../app/lib/delivery-operational.postgres.ts", import.meta.url);
const sharedStoreSource = new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url);
const exportRouteSource = new URL("../app/api/operations/export/route.ts", import.meta.url);
const viteSource = new URL("../vite.config.ts", import.meta.url);

test("operational delivery window keeps every active delivery and only a bounded recent completed set", async () => {
  const source = await readFile(operationalSource, "utf8");
  assert.match(source, /OPERATIONAL_RECENT_DAYS = 7/);
  assert.match(source, /OPERATIONAL_RECENT_COMPLETED_LIMIT = 200/);
  assert.match(source, /delivery\.status <> 'Delivered'/);
  assert.match(source, /delivery\.status = 'Delivered'/);
  assert.match(source, /LIMIT \$\{recentCompletedLimit\}/);
  const activeBlock = source.slice(source.indexOf("WITH active AS"), source.indexOf("recent_completed AS"));
  assert.doesNotMatch(activeBlock, /LIMIT/i, "active deliveries must never be silently truncated");
});

test("recent completion detection is tenant scoped and includes recent delivery activity", async () => {
  const source = await readFile(operationalSource, "utf8");
  assert.ok((source.match(/delivery\.company_id = \$\{companyId\}/g) ?? []).length >= 2);
  assert.match(source, /FROM delivery_events event/);
  assert.match(source, /event\.delivery_id = delivery\.id/);
  assert.match(source, /event\.created_at >= NOW\(\)/);
});

test("shared Postgres hot path overrides only company delivery listing", async () => {
  const source = await readFile(sharedStoreSource, "utf8");
  assert.match(source, /loadOperationalDeliveries/);
  assert.match(source, /listForCompany: loadOperationalDeliveries/);
  assert.match(source, /\.\.\.baseStore/);
});

test("full history remains explicitly available for tenant export", async () => {
  const exportSource = await readFile(exportRouteSource, "utf8");
  const vite = await readFile(viteSource, "utf8");
  assert.match(exportSource, /trackfleet-delivery-store-full/);
  assert.match(vite, /"trackfleet-delivery-store-full": fullDeliveryStorePath/);
  assert.match(vite, /delivery-store\.full-shared-postgres\.ts/);
});
