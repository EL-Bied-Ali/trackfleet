import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const helper = fs.readFileSync("app/lib/d1-read-failover.ts", "utf8");
const delivery = fs.readFileSync("app/lib/delivery-store.cloudflare-postgres-failover.ts", "utf8");
const operational = fs.readFileSync("app/lib/delivery-operational.cloudflare.ts", "utf8");
const session = fs.readFileSync("app/lib/auth-session-store.cloudflare-postgres-failover.ts", "utf8");
const sites = fs.readFileSync("app/lib/site-store.cloudflare-postgres-failover.ts", "utf8");
const safeReconciliation = fs.readFileSync("app/lib/d1-reconciliation-safe.ts", "utf8");
const worker = fs.readFileSync("worker/index.ts", "utf8");
const vite = fs.readFileSync("vite.config.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

test("D1 read failover is opt-in, readiness-gated and leased", () => {
  assert.match(helper, /TRACKFLEET_D1_READ_FAILOVER/);
  assert.match(helper, /getD1StandbyReadiness\(db\)/);
  assert.match(helper, /if \(!configured\(\)\) return false/);
  assert.match(helper, /if \(!\(await approveAndActivateFailover\(\)\)\) throw primaryError/);
  assert.match(helper, /D1_READ_FAILOVER_LEASE_MS = 5 \* 60_000/);
  assert.match(helper, /id = 'd1_read_failover'/);
  assert.match(envExample, /TRACKFLEET_D1_READ_FAILOVER=false/);
});

test("Cloudflare Postgres runtime uses failover wrappers while Vercel stays on normal Postgres stores", () => {
  assert.match(vite, /const useCloudflarePostgresFailover = !isVercel && process\.env\.TRACKFLEET_STORAGE === "postgres"/);
  assert.match(vite, /delivery-store\.cloudflare-postgres-failover\.ts/);
  assert.match(vite, /site-store\.cloudflare-postgres-failover\.ts/);
  assert.match(vite, /auth-session-store\.cloudflare-postgres-failover\.ts/);
  assert.match(vite, /useSharedPostgres/);
  assert.match(vite, /delivery-store\.shared-postgres\.ts/);
});

test("operational D1 fallback mirrors the bounded Postgres dashboard window", () => {
  assert.match(operational, /OPERATIONAL_RECENT_DAYS = 7/);
  assert.match(operational, /OPERATIONAL_RECENT_COMPLETED_LIMIT = 200/);
  assert.match(operational, /status <> 'Delivered'/);
  assert.match(operational, /delivery_events/);
  assert.match(operational, /UNION ALL/);
  assert.doesNotMatch(operational, /INSERT|UPDATE|DELETE|ALTER|CREATE TABLE/i);
});

test("delivery standby wrapper falls back only on reads and never calls D1 business mutations", () => {
  for (const name of [
    "getPublic", "listForCompany", "listEvents", "listEtaObservations",
    "listEtaObservationsForRoute", "listTripPositionsForRoute", "listFleetPositions",
    "getTrip", "listTrips", "listDeliveryIdsForTrip",
  ]) assert.match(delivery, new RegExp(`\\b${name}\\b`));
  assert.match(delivery, /withD1ReadFailover/);
  assert.match(delivery, /loadOperationalDeliveriesFromD1/);
  assert.doesNotMatch(delivery, /standbyStore\.(create|linkVehicle|upsertTrip|assignDeliveryTrip|assignDeliveryToPlannedTrip)\(/);
  assert.match(delivery, /create: primaryStore\.create/);
});

test("GET-side maintenance becomes no-op during failover without making D1 writable", () => {
  assert.match(delivery, /suppressMaintenanceWriteDuringD1Failover/);
  assert.match(delivery, /applySendatrackSnapshot/);
  assert.match(delivery, /recordEvent/);
  assert.match(delivery, /recordEtaObservation/);
  assert.match(delivery, /recordTripPosition/);
  assert.match(delivery, /recordFleetPosition/);
  assert.match(delivery, /if \(await d1ReadFailoverActive\(\)\)/);
  assert.doesNotMatch(delivery, /standbyStore\.(record|apply|assign|link|upsert|create)/);
});

test("existing sessions and site reads can fall back but their explicit writes remain primary", () => {
  assert.match(session, /withD1ReadFailover/);
  assert.match(session, /getStandbySession/);
  assert.match(session, /createPrimarySession/);
  assert.match(session, /deletePrimarySession/);
  assert.doesNotMatch(session, /createServerSession as createStandby/);

  assert.match(sites, /withD1ReadFailover/);
  assert.match(sites, /SELECT \* FROM sites WHERE company_id = \? ORDER BY label/);
  assert.match(sites, /return primarySiteStore\.upsert\(input\)/);
  assert.doesNotMatch(sites, /INSERT|UPDATE|DELETE|ALTER|CREATE TABLE/i);
});

test("Worker blocks external mutations while the read-only lease is active", () => {
  assert.match(worker, /request\.method !== "GET" && request\.method !== "HEAD" && await d1ReadFailoverActive\(\)/);
  assert.match(worker, /error: "read_only_failover"/);
  assert.match(worker, /status: 503/);
  assert.match(worker, /"retry-after": "60"/);
});

test("reconciliation refuses silent company or session truncation before freshness can be renewed", () => {
  assert.match(safeReconciliation, /D1_RECONCILIATION_MAX_COMPANIES = 5/);
  assert.match(safeReconciliation, /D1_RECONCILIATION_MAX_ACTIVE_SESSIONS = 200/);
  assert.match(safeReconciliation, /COUNT\(DISTINCT company_id\)/);
  assert.match(safeReconciliation, /COUNT\(\*\) FROM sessions WHERE expires_at > NOW\(\)/);
  assert.match(safeReconciliation, /last_failure_at/);
  assert.match(safeReconciliation, /d1_reconciliation_coverage_exceeded/);
});
