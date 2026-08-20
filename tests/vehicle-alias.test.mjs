import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const d1Schema = fs.readFileSync("scripts/prepare-d1-schema.mjs", "utf8");
const cloudflareStore = fs.readFileSync("app/lib/vehicle-alias-store.cloudflare.ts", "utf8");
const sharedPostgresStore = fs.readFileSync("app/lib/vehicle-alias-store.shared-postgres.ts", "utf8");
const postgresStore = fs.readFileSync("app/lib/vehicle-alias-store.postgres.ts", "utf8");
const vercelStore = fs.readFileSync("app/lib/vehicle-alias-store.vercel.ts", "utf8");
const viteConfig = fs.readFileSync("vite.config.ts", "utf8");
const tsconfigVercel = fs.readFileSync("tsconfig.vercel.json", "utf8");
const route = fs.readFileSync("app/api/vehicles/alias/route.ts", "utf8");
const deliveriesRoute = fs.readFileSync("app/api/deliveries/route.ts", "utf8");
const sendatrackRoute = fs.readFileSync("app/api/sendatrack/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");

test("D1 schema defines a company-scoped vehicle_aliases table", () => {
  assert.match(d1Schema, /CREATE TABLE IF NOT EXISTS vehicle_aliases \(/);
  assert.match(d1Schema, /PRIMARY KEY \(company_id, sendatrack_vehicle_id\)/);
});

test("Postgres store gates schema creation behind the explicit bootstrap flag", () => {
  assert.match(postgresStore, /runtimeSchemaBootstrapEnabled = process\.env\.TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP === "true"/);
  assert.match(postgresStore, /if \(!runtimeSchemaBootstrapEnabled\) return;/);
  assert.match(postgresStore, /CREATE TABLE IF NOT EXISTS vehicle_aliases/);
  assert.match(postgresStore, /ON CONFLICT \(company_id, sendatrack_vehicle_id\) DO UPDATE/);
});

test("Vercel store selects Postgres when DATABASE_URL is configured, memory otherwise", () => {
  assert.match(vercelStore, /process\.env\.DATABASE_URL\?\.trim\(\)/);
  assert.match(vercelStore, /await import\("\.\/vehicle-alias-store\.postgres"\)/);
  assert.match(vercelStore, /memoryVehicleAliasStore/);
});

test("shared-Postgres store mirrors to D1 best-effort without blocking the write", () => {
  assert.match(sharedPostgresStore, /const alias = await primaryVehicleAliasStore\.set\(input\);\s*await mirrorAlias\(alias\);\s*return alias;/s);
  assert.match(sharedPostgresStore, /catch \(error\) \{\s*console\.error\("\[trackfleet:replication\] D1 vehicle alias mirror failed"/s);
  assert.doesNotMatch(sharedPostgresStore, /throw error/);
});

test("Cloudflare-only store talks to D1 directly", () => {
  assert.match(cloudflareStore, /runtimeEnv\.DB/);
  assert.match(cloudflareStore, /INSERT INTO vehicle_aliases/);
});

test("vite.config wires the vehicle alias store alongside the site store, and the Vercel tsconfig excludes the D1-only variant", () => {
  assert.match(viteConfig, /"trackfleet-vehicle-alias-store": vehicleAliasStorePath/);
  assert.match(viteConfig, /vehicle-alias-store\.shared-postgres\.ts/);
  assert.match(viteConfig, /vehicle-alias-store\.cloudflare\.ts/);
  assert.match(tsconfigVercel, /"trackfleet-vehicle-alias-store": \["\.\/app\/lib\/vehicle-alias-store\.vercel\.ts"\]/);
  assert.match(tsconfigVercel, /"app\/lib\/vehicle-alias-store\.cloudflare\.ts"/);
});

test("renaming a vehicle requires an authenticated dispatcher and same-origin request", () => {
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /getCompanySession\(request\)/);
  assert.match(route, /session\.role !== "dispatcher"/);
  assert.match(route, /alias\.length > 60/);
});

test("agencies can still read vehicle aliases", () => {
  const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /role/);
});

test("vehicle aliases override the raw SENDATRACK name in every fleet snapshot endpoint", () => {
  assert.match(deliveriesRoute, /vehicleAliasStore\.listForCompany\(session\.companyId\)/);
  assert.match(deliveriesRoute, /name: vehicleAliasById\.get\(vehicle\.id\) \?\? vehicle\.name/);
  assert.match(sendatrackRoute, /vehicleAliasStore\.listForCompany\(session\.companyId\)/);
  assert.match(sendatrackRoute, /name: vehicleAliasById\.get\(vehicle\.id\) \?\? vehicle\.name/);
});

test("renaming a vehicle from the dashboard is dispatcher-only and posts to the alias endpoint", () => {
  assert.match(page, /fetch\("\/api\/vehicles\/alias", \{/);
  assert.match(page, /company\?\.role === "dispatcher" && !isUnassignedVehicle\(selected\)/);
});
