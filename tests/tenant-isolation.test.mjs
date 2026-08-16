import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const files = [
  "app/lib/delivery-store.memory.ts",
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
];

test("production company queries never include demo deliveries", () => {
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!source.includes("companyId || delivery.companyId === \"demo\""), `${file} still mixes demo deliveries`);
    assert.ok(!source.includes("company_id = 'demo'"), `${file} still mixes demo rows in SQL`);
  }
});
