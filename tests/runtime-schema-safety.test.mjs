import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const postgresStore = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
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

test("production environment example keeps runtime schema bootstrap disabled", () => {
  assert.match(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=false/);
  assert.doesNotMatch(envExample, /TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP=true/);
});
