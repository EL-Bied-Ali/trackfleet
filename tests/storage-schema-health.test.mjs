import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadContract() {
  const source = await readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", output)(exports);
  return exports;
}

test("schema contract covers every persistent production subsystem", async () => {
  const { REQUIRED_POSTGRES_TABLES } = await loadContract();
  assert.deepEqual(new Set(REQUIRED_POSTGRES_TABLES), new Set([
    "automation_runtime_state",
    "companies",
    "deliveries",
    "delivery_eta_observations",
    "delivery_events",
    "delivery_notifications",
    "fleet_position_observations",
    "google_links",
    "login_rate_limits",
    "sessions",
    "sites",
    "subscriptions",
    "trip_position_observations",
    "trips",
  ]));
});

test("schema contract protects columns added by later TrackFleet features", async () => {
  const { REQUIRED_POSTGRES_COLUMNS } = await loadContract();
  const keys = new Set(REQUIRED_POSTGRES_COLUMNS.map(({ table, column }) => `${table}.${column}`));
  for (const key of [
    "deliveries.trip_id",
    "deliveries.whatsapp_opt_in",
    "deliveries.recipient_name",
    "deliveries.recipient_contact",
    "deliveries.recipient_whatsapp_opt_in",
    "deliveries.recipient_whatsapp_opt_in_at",
    "delivery_eta_observations.route_template_id",
    "delivery_eta_observations.trip_instance_id",
    "sessions.company_id",
    "sessions.credentials_ciphertext",
    "sites.arrival_radius_km",
    "trips.stops_json",
  ]) assert.ok(keys.has(key), `missing schema contract entry: ${key}`);
});

test("schema probe normalization never treats an absent row as healthy", async () => {
  const { normalizePostgresSchemaProbe } = await loadContract();
  assert.deepEqual(normalizePostgresSchemaProbe(undefined), {
    compatible: false,
    missingTables: [],
    missingColumns: [],
  });
  assert.deepEqual(normalizePostgresSchemaProbe({
    compatible: false,
    missing_tables: ["trips"],
    missing_columns: ["deliveries.trip_id"],
  }), {
    compatible: false,
    missingTables: ["trips"],
    missingColumns: ["deliveries.trip_id"],
  });
});

test("storage health uses one read-only catalog probe and exposes schema incompatibility", async () => {
  const source = await readFile(new URL("../app/lib/storage-health.ts", import.meta.url), "utf8");
  assert.match(source, /jsonb_array_elements_text\(\$\{requiredTables\}::jsonb\)/);
  assert.match(source, /jsonb_array_elements\(\$\{requiredColumns\}::jsonb\)/);
  assert.match(source, /postgres_schema_incompatible/);
  assert.doesNotMatch(source, /CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i);
});
