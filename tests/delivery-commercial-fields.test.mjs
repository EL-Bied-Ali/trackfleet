import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeDeliveryPrice,
  DELIVERY_PRICE_RATE_EUR_PER_KG,
  DELIVERY_PRICE_RATE_MAD_PER_KG,
} from "../app/lib/delivery-pricing.ts";

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

test("declared weight is validated, but price is never accepted from the client", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /weightKg must be greater than 0/);
  assert.match(route, /computeDeliveryPrice\(weightKg, originSite\?\.country \?\? null\)/);
  assert.doesNotMatch(route, /payload\.priceAmount/);
  assert.doesNotMatch(route, /payload\.priceCurrency/);
  assert.match(route, /weightKg,/);
  assert.match(route, /priceAmount,/);
  assert.match(route, /priceCurrency,/);
});

test("price is 1.5 EUR/kg by default, and 15 MAD/kg when the parcel ships from Morocco", () => {
  assert.equal(DELIVERY_PRICE_RATE_EUR_PER_KG, 1.5);
  assert.equal(DELIVERY_PRICE_RATE_MAD_PER_KG, 15);
  assert.deepEqual(computeDeliveryPrice(10, "BE"), { priceAmount: 15, priceCurrency: "EUR" });
  assert.deepEqual(computeDeliveryPrice(10, null), { priceAmount: 15, priceCurrency: "EUR" });
  assert.deepEqual(computeDeliveryPrice(10, "MA"), { priceAmount: 150, priceCurrency: "MAD" });
  assert.deepEqual(computeDeliveryPrice(null, "MA"), { priceAmount: null, priceCurrency: null });
  assert.deepEqual(computeDeliveryPrice(0, "MA"), { priceAmount: null, priceCurrency: null });
  // Rounds to cents, e.g. 12.345 kg * 1.5 = 18.5175 -> 18.52
  assert.deepEqual(computeDeliveryPrice(12.345, "BE"), { priceAmount: 18.52, priceCurrency: "EUR" });
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

test("weight is entered by the dispatcher; price is shown as a computed preview, not a free-form field", () => {
  const page = files["app/page.tsx"];
  const publicView = files["app/lib/public-delivery-view.ts"];
  assert.match(page, /name="weightKg"/);
  assert.doesNotMatch(page, /name="priceAmount"/);
  assert.doesNotMatch(page, /name="priceCurrency"/);
  assert.match(page, /computeDeliveryPrice\(/);
  assert.match(page, /selected\.weightKg/);
  assert.match(page, /selected\.priceAmount/);
  assert.match(publicView, /weightKg: delivery\.weightKg/);
  assert.match(publicView, /priceAmount: delivery\.priceAmount/);
  assert.match(publicView, /priceCurrency: delivery\.priceCurrency/);
});
