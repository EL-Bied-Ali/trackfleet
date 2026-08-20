import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const postgresStore = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
const postgresHeartbeat = fs.readFileSync("app/lib/automation-heartbeat.vercel.ts", "utf8");
const d1RuntimeAdapters = fs.readdirSync("app/lib")
  .filter((name) => name.endsWith(".cloudflare.ts"))
  .sort()
  .map((name) => {
    const filePath = path.join("app/lib", name);
    return { path: filePath, source: fs.readFileSync(filePath, "utf8") };
  });
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

test("Cloudflare runtime adapters never perform schema DDL or schema introspection", () => {
  assert.ok(d1RuntimeAdapters.length > 0, "Cloudflare runtime adapters must be discovered");
  for (const { path: filePath, source } of d1RuntimeAdapters) {
    assert.doesNotMatch(source, /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)/i, `${filePath} must not create schema objects at runtime`);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i, `${filePath} must not alter schema at runtime`);
    assert.doesNotMatch(source, /PRAGMA\s+table_info/i, `${filePath} must not introspect schema at runtime`);
  }
});

test("D1 schema preparation is explicit and outside runtime adapters", () => {
  assert.match(d1SchemaPreparation, /wrangler/);
  assert.match(d1SchemaPreparation, /PRAGMA table_info\(\$\{table\}\)/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS deliveries/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS automation_runtime_state/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS telemetry_retention_state/);
  assert.match(d1SchemaPreparation, /CREATE TABLE IF NOT EXISTS delivery_arrival_state/);
  assert.match(d1SchemaPreparation, /execFileSync\(process\.execPath, args/);
  assert.doesNotMatch(d1SchemaPreparation, /pnpm\.cmd/);
});

test("runtime heartbeat adapters never perform schema DDL", () => {
  for (const source of [postgresHeartbeat, d1RuntimeAdapters.find(({ path: filePath }) => filePath.endsWith("automation-heartbeat.cloudflare.ts"))?.source ?? ""]) {
    assert.doesNotMatch(source, /CREATE\s+TABLE/i);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i);
    assert.match(source, /automation_runtime_state/);
  }
});

test("production environment example keeps runtime schema bootstrap disabled", () => {
  assert.match(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=false/);
  assert.doesNotMatch(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=true/);
});
