import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const postgres = fs.readFileSync(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8");
const cloudflare = fs.readFileSync(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");

test("persistent stores keep delivery to trip assignment immutable", () => {
  assert.match(postgres, /ADD COLUMN IF NOT EXISTS trip_id text/);
  assert.match(postgres, /trip_id IS NULL OR trip_id =/);
  assert.match(cloudflare, /ALTER TABLE deliveries ADD COLUMN trip_id text/);
  assert.match(cloudflare, /trip_id IS NULL OR trip_id = \?/);
  assert.match(schema, /tripId: text\("trip_id"\)/);
});
