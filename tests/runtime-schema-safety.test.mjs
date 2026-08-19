import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const postgresStore = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
const postgresHeartbeat = fs.readFileSync("app/lib/automation-heartbeat.vercel.ts", "utf8");
const d1RuntimeAdapters = [
  "app/lib/auth-session-store.cloudflare.ts",
  "app/lib/automation-heartbeat.cloudflare.ts",
  "app/lib/delivery-completion.cloudflare.ts",
  "app/lib/delivery-store.cloudflare.ts",
  "app/lib/login-rate-limit.cloudflare.ts",
  "app/lib/site-store.cloudflare.ts",
  "app/lib/telemetry-retention.cloudflare.ts",
].map((path) => ({ path, source: fs.readFileSync(path, "utf8") }));
const d1SchemaPreparation = fs.readFileSync("scripts/prepare-d1-schema.mjs", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

test("Postgres schema bootstrap is opt-in and guarded before any runtime DDL", () => {
  assert.match(
    postgresStore,
    /const runtimeSchemaBootstrapEnabled = process\.env\.TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP === "true";/,
  );

  const ensureSchemaStart = postgresStore.indexOf("async function ensureSchema()");
  const guard = postgresStore.indexOf("if (!runtimeSchemaBootstrapEnabled) return;", ensureSchemaStart);
  const firstDdl = postgresStore.indexOf("CREATE TABLE IF NOT EXISTS", ensureSchemaStart);

  assert.ok(ensureSchemaStart >= 0, "ensureSchema must exist");
  assert.ok(guard > ensureSchemaStart, "runtime bootstrap guard must be inside ensureSchema");
  assert.ok(firstDdl > guard, "the opt-in guard must run before any schema DDL");
});

test("Cloudflare D1 runtime adapters never perform schema DDL or schema introspection", () => {
  for (const { path, source } of d1RuntimeAdapters) {
    assert.doesNotMatch(source, /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)/i, `${path} must not create schema objects at runtime`);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i, `${path} must not alter schema at runtime`);
    assert.doesNotMatch(source, /PRAGMA\s+table_info/i, `${path} must not introspect schema at runtime`);
  }
});

test("D1 schema preparation is explicit and outside runtime adapters", () => {
  assert.match(d1SchemaPreparation, /wrangler/);
  assert.match(d1SchemaPreparation, /PRAGMA table_info\(deliveries\)/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS deliveries/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS automation_runtime_state/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS telemetry_retention_state/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS delivery_arrival_state/);
});

test("runtime heartbeat adapters never perform schema DDL", () => {
  for (const source of [postgresHeartbeat, d1RuntimeAdapters.find(({ path }) => path.endsWith("automation-heartbeat.cloudflare.ts"))?.source ?? ""]) {
    assert.doesNotMatch(source, /CREATE\s+TABLE/i);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i);
    assert.match(source, /automation_runtime_state/);
  }
});

test("production environment example keeps runtime schema bootstrap disabled", () => {
  assert.match(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=false/);
  assert.doesNotMatch(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=true/);
});
