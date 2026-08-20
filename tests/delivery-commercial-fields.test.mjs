import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/deliveries/route.ts",
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-store.shared-postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
  "app/lib/d1-standby-read-store.ts",
  "app/lib/d1-history-backfill.ts",
  "app/lib/d1-reconciliation.ts",
  "scripts/prepare-d1-schema.mjs",
  "app/lib/public-delivery-view.ts",
  "app/page.tsx",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

test("delivery creation validates optional weight and EUR/MAD price pairs", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /weightKg must be greater than 0/);
  assert.match(route, /priceAmount and priceCurrency must be provided together/);
  assert.match(route, /priceCurrency must be EUR or MAD/);
  assert.match(route, /weightKg,/);
  assert.match(route, /priceAmount,/);
  assert.match(route, /priceCurrency,/);
});

test("commercial fields persist through Postgres, D1 mirror, standby and reconciliation", () => {
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.shared-postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/d1-standby-read-store.ts",
    "app/lib/d1-history-backfill.ts",
    "app/lib/d1-reconciliation.ts",
    "scripts/prepare-d1-schema.mjs",
  ]) {
    const source = files[path];
    for (const column of ["weight_kg", "price_amount", "price_currency"]) {
      assert.match(source, new RegExp(column), `${path} must preserve ${column}`);
    }
  }
});

test("commercial fields are rendered for employees and private customer tracking", () => {
  const page = files["app/page.tsx"];
  const publicView = files["app/lib/public-delivery-view.ts"];
  assert.match(page, /name="weightKg"/);
  assert.match(page, /name="priceAmount"/);
  assert.match(page, /name="priceCurrency"/);
  assert.match(page, /selected\.weightKg/);
  assert.match(page, /selected\.priceAmount/);
  assert.match(publicView, /weightKg: delivery\.weightKg/);
  assert.match(publicView, /priceAmount: delivery\.priceAmount/);
  assert.match(publicView, /priceCurrency: delivery\.priceCurrency/);
});
