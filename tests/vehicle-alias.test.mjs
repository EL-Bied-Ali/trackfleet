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
const linkVehicleRoute = fs.readFileSync("app/api/deliveries/link-vehicle/route.ts", "utf8");
const createTripRoute = fs.readFileSync("app/api/deliveries/create-trip/route.ts", "utf8");
const vehicleAliasApply = fs.readFileSync("app/lib/vehicle-alias-apply.ts", "utf8");
const serverAutomation = fs.readFileSync("app/lib/server-automation.ts", "utf8");
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

// Reported live during an audit: a dispatcher's chosen alias was only ever
// applied to the live vehicle-picker list -- the moment a vehicle actually
// got used (linked to a delivery, matched automatically by
// applySendatrackSnapshot on every single poll, or logged to fleet position
// history), every one of those call sites read the raw SENDATRACK snapshot
// directly, so a renamed truck reverted to its real fleet id in the
// delivery table, WhatsApp messages, trip records and position history the
// instant it stopped being merely "in the picker" -- which for an
// automatically GPS-matched delivery is within one poll (30s). Fixed by
// applying the alias once, right where each snapshot is fetched
// (vehicle-alias-apply.ts's applyVehicleAliases), so every downstream
// consumer of that snapshot object gets the aliased name for free instead
// of each call site needing its own lookup to remember.
test("vehicle-alias-apply.ts substitutes the dispatcher's alias for the raw SENDATRACK name across the whole snapshot, once, right after it's fetched", () => {
  assert.match(vehicleAliasApply, /vehicleAliasStore\.listForCompany\(companyId\)/);
  assert.match(vehicleAliasApply, /vehicles: snapshot\.vehicles\.map\(\(vehicle\) => \{/);
  assert.match(vehicleAliasApply, /const alias = aliasById\.get\(vehicle\.id\);/);
  assert.match(vehicleAliasApply, /return alias \? \{ \.\.\.vehicle, name: alias \} : vehicle;/);
});

test("every place that reads a live SENDATRACK snapshot applies the alias substitution before using it, not just the vehicle-picker list", () => {
  for (const [name, source] of [
    ["GET /api/deliveries (both the automatic matching pass and the picker list)", deliveriesRoute],
    ["GET /api/sendatrack", sendatrackRoute],
    ["POST /api/deliveries/link-vehicle (single and group reassignment)", linkVehicleRoute],
    ["POST /api/deliveries/create-trip", createTripRoute],
    ["the scheduled fleet automation tick (server-automation.ts)", serverAutomation],
  ]) {
    assert.match(source, /applyVehicleAliases\(/, `expected ${name} to call applyVehicleAliases`);
  }
});

test("GET /api/deliveries no longer duplicates its own alias lookup for the picker list -- it reuses the already-aliased snapshot", () => {
  assert.doesNotMatch(deliveriesRoute, /vehicleAliasStore\.listForCompany/);
  assert.match(deliveriesRoute, /name: vehicle\.name, speed: vehicle\.speed/);
});

test("renaming a vehicle from the dashboard is dispatcher-only and posts to the alias endpoint", () => {
  assert.match(page, /fetch\("\/api\/vehicles\/alias", \{/);
  assert.match(page, /company\?\.role === "dispatcher" && !isUnassignedVehicle\(selected\)/);
});
