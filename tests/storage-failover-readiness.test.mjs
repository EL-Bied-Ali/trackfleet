import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const health = fs.readFileSync("app/lib/storage-health.ts", "utf8");
const vite = fs.readFileSync("vite.config.ts", "utf8");

test("Postgres health reports D1 standby separately from the active backend", () => {
  assert.match(health, /failover: StorageFailoverHealth/);
  assert.match(health, /candidate: "cloudflare-d1"/);
  assert.match(health, /automatic: false/);
  assert.match(health, /reason: "replication_not_configured"/);
});

test("current Cloudflare storage selection remains build-time until replication exists", () => {
  assert.match(vite, /process\.env\.TRACKFLEET_STORAGE === "postgres"/);
  assert.match(vite, /useSharedPostgres \? "\.\/app\/lib\/delivery-store\.shared-postgres\.ts" : "\.\/app\/lib\/delivery-store\.cloudflare\.ts"/);
});

test("health never claims automatic D1 failover before replication is configured", () => {
  assert.doesNotMatch(health, /automatic:\s*true/);
});
