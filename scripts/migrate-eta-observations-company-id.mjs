// One-off production migration: adds delivery_eta_observations.company_id,
// backfills it from each observation's own delivery, and adds the
// company-scoped index that replaces the old, tenant-blind one. Run once
// via the "One-off: migrate eta_observations company_id" workflow (CI has
// DATABASE_URL as a secret; this script is never run with a locally-visible
// connection string). Safe to re-run: every statement is idempotent.

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const sql = postgres(databaseUrl, { max: 1 });

await sql`ALTER TABLE delivery_eta_observations ADD COLUMN IF NOT EXISTS company_id text`;
console.log("[migrate] company_id column present");

const backfilled = await sql`
  UPDATE delivery_eta_observations o SET company_id = d.company_id
  FROM deliveries d
  WHERE o.delivery_id = d.id AND o.company_id IS NULL
  RETURNING o.delivery_id
`;
console.log(`[migrate] backfilled ${backfilled.length} row(s) from their own delivery`);

const stillNull = await sql`SELECT count(*)::int AS count FROM delivery_eta_observations WHERE company_id IS NULL`;
console.log(`[migrate] rows still missing company_id after backfill (orphaned -- no matching delivery, e.g. a deleted one): ${stillNull[0].count}`);

await sql`CREATE INDEX IF NOT EXISTS idx_eta_observations_company_route_destination ON delivery_eta_observations(company_id, route_template_id, destination_site_id, position_at DESC)`;
console.log("[migrate] idx_eta_observations_company_route_destination present");

console.log("[migrate] done");
