import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { project30dRows } from "../app/lib/telemetry-growth-projection.ts";

const reportSource = new URL("../app/lib/telemetry-growth.ts", import.meta.url);
const routeSource = new URL("../app/api/operations/storage/route.ts", import.meta.url);

test("30-day projection follows the faster recent ingestion rate", () => {
  assert.equal(project30dRows(700, 150), 4500);
  assert.equal(project30dRows(700, 50), 3000);
  assert.equal(project30dRows(0, 0), 0);
});

test("telemetry SQL is tenant scoped and remains one database round trip", async () => {
  const source = await readFile(reportSource, "utf8");
  assert.match(source, /FROM fleet_position_observations[\s\S]*WHERE company_id = \$\{companyId\}/);
  assert.match(source, /FROM trip_position_observations[\s\S]*WHERE company_id = \$\{companyId\}/);
  assert.match(source, /JOIN deliveries delivery ON delivery\.id = observation\.delivery_id[\s\S]*WHERE delivery\.company_id = \$\{companyId\}/);
  assert.match(source, /JOIN deliveries delivery ON delivery\.id = event\.delivery_id[\s\S]*WHERE delivery\.company_id = \$\{companyId\}/);
  assert.equal((source.match(/await sql`/g) ?? []).length, 1);
});

test("storage operations endpoint requires a company session and never caches authentication failures", async () => {
  const source = await readFile(routeSource, "utf8");
  assert.match(source, /getDispatcherSession\(request\)/);
  assert.match(source, /status: 401/);
  assert.match(source, /cache-control": "no-store"/);
  assert.match(source, /getTelemetryGrowthReport\(session\.companyId\)/);
});
