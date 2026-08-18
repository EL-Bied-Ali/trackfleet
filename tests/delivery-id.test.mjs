import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDeliveryId, deliveryIdIsValid } from "../app/lib/delivery-id.ts";

const storeUrls = [
  "../app/lib/delivery-store.memory.ts",
  "../app/lib/delivery-store.postgres.ts",
  "../app/lib/delivery-store.cloudflare.ts",
];
const stores = await Promise.all(storeUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")));

test("delivery ids use the stable TF prefix and 64 bits of random data", () => {
  for (let index = 0; index < 1000; index += 1) {
    assert.equal(deliveryIdIsValid(createDeliveryId()), true);
  }
});

test("a large local sample has no delivery id collisions", () => {
  const ids = Array.from({ length: 10_000 }, () => createDeliveryId());
  assert.equal(new Set(ids).size, ids.length);
});

test("every store uses the shared random delivery id generator", () => {
  for (const source of stores) {
    assert.match(source, /createDeliveryId\(\)/);
    assert.doesNotMatch(source, /id:\s*`TF-\$\{String\(Date\.now\(\)\)\.slice\(-6\)\}`/);
  }
});
