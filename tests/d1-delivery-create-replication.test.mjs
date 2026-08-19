import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/delivery-store.shared-postgres.ts", "utf8");

test("delivery creation commits to Postgres before mirroring to D1", () => {
  assert.match(source, /const delivery = await baseStore\.create\(input\);\s*await mirrorDelivery\(delivery\);\s*return delivery;/s);
  assert.match(source, /INSERT INTO deliveries/);
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE/);
});

test("D1 delivery mirror preserves identity and tracking fields", () => {
  assert.match(source, /delivery\.id/);
  assert.match(source, /delivery\.trackingToken/);
  assert.match(source, /delivery\.companyId/);
  assert.match(source, /delivery\.createdAt\.getTime\(\)/);
});

test("D1 delivery replication is best-effort", () => {
  assert.match(source, /function replicationError\(scope: string, error: unknown, context: Record<string, unknown>\)/);
  assert.match(source, /console\.error\(`\[trackfleet:replication\] D1 \$\{scope\} mirror failed`/);
  assert.match(source, /catch \(error\) \{\s*replicationError\("delivery", error,/s);
  assert.doesNotMatch(source, /throw error/);
});
