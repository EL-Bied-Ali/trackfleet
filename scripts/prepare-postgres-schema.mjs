// Pre-deploy gate against the *real* production Postgres schema.
//
// delivery-store.postgres.ts's ensureSchema() (CREATE TABLE IF NOT EXISTS +
// ALTER TABLE ADD COLUMN IF NOT EXISTS, all idempotent) is deliberately a
// no-op at request time in production -- see runtimeSchemaBootstrapEnabled
// there -- so a column added to storage-schema-contract.ts's
// REQUIRED_POSTGRES_COLUMNS never actually reaches the live database on its
// own; the app just starts reporting postgres_schema_incompatible once the
// new code (which now requires that column) goes live. That's exactly what
// happened shipping item_description: production degraded to D1 read
// failover for ~10 minutes because nothing checked the real schema before
// the new Worker version deployed.
//
// This script can't safely import delivery-store.postgres.ts directly (it
// and its dependencies use extensionless internal imports that only resolve
// under Vite/vinext's bundler, not plain Node), so duplicating that file's
// DDL here would be its own maintenance-drift risk. Instead this only reads
// the schema *contract* (storage-schema-contract.ts has no imports of its
// own, so it resolves fine under plain Node) and fails the deploy loudly,
// with an actionable message, if the live database doesn't already satisfy
// it -- turning a silent post-deploy degradation into a blocked deploy.
//
// Fixing a real gap: run the missing ALTER TABLE statement(s) against
// DATABASE_URL (e.g. via a short local Node script, same as this file's
// probe query) *before* re-running this gate.

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.log("[postgres-schema] DATABASE_URL not set, skipping (this deployment target has no Postgres primary, or the DATABASE_URL repository secret hasn't been configured yet).");
  process.exit(0);
}

const { default: postgres } = await import("postgres");
const { REQUIRED_POSTGRES_TABLES, REQUIRED_POSTGRES_COLUMNS } = await import("../app/lib/storage-schema-contract.ts");
const sql = postgres(databaseUrl, { max: 1 });

const rows = await sql`
  WITH required_tables AS (
    SELECT value AS table_name
    FROM jsonb_array_elements_text(${sql.json(REQUIRED_POSTGRES_TABLES)}::jsonb)
  ),
  required_columns AS (
    SELECT item->>'table' AS table_name, item->>'column' AS column_name
    FROM jsonb_array_elements(${sql.json(REQUIRED_POSTGRES_COLUMNS)}::jsonb) item
  ),
  missing_tables AS (
    SELECT required.table_name FROM required_tables required
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.tables actual
      WHERE actual.table_schema = 'public' AND actual.table_name = required.table_name
    )
  ),
  missing_columns AS (
    SELECT required.table_name, required.column_name FROM required_columns required
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
    )
  )
  SELECT
    COALESCE((SELECT json_agg(table_name ORDER BY table_name) FROM missing_tables), '[]'::json) AS missing_tables,
    COALESCE((SELECT json_agg(table_name || '.' || column_name ORDER BY table_name, column_name) FROM missing_columns), '[]'::json) AS missing_columns
`;
const { missing_tables: missingTables, missing_columns: missingColumns } = rows[0] ?? { missing_tables: [], missing_columns: [] };

if (missingTables.length || missingColumns.length) {
  console.error("[postgres-schema] production Postgres does not satisfy storage-schema-contract.ts:");
  if (missingTables.length) console.error(`  missing tables: ${missingTables.join(", ")}`);
  if (missingColumns.length) console.error(`  missing columns: ${missingColumns.join(", ")}`);
  console.error("[postgres-schema] apply the matching ALTER TABLE / CREATE TABLE statement(s) from ensureSchema() in app/lib/delivery-store.postgres.ts against DATABASE_URL, then re-run this deploy.");
  await sql.end();
  process.exit(1);
}

console.log("[postgres-schema] production Postgres schema is compatible with the current contract.");
await sql.end();
