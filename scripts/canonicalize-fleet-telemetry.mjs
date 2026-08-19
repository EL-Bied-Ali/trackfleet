import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply");
const sql = neon(databaseUrl);

const summary = await sql.query(`
  WITH groups AS (
    SELECT company_id, vehicle_name, position_at, count(*) AS copies
    FROM fleet_position_observations
    WHERE trim(vehicle_name) <> ''
    GROUP BY company_id, vehicle_name, position_at
  )
  SELECT
    (SELECT count(*) FROM fleet_position_observations)::int AS total_rows,
    (SELECT count(DISTINCT vehicle_name) FROM fleet_position_observations)::int AS physical_names,
    (SELECT count(DISTINCT vehicle_id) FROM fleet_position_observations)::int AS source_ids,
    coalesce(sum(GREATEST(copies - 1, 0)), 0)::int AS duplicate_rows
  FROM groups
`);
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", before: summary[0] }, null, 2));

if (!apply) {
  console.log("Dry run only. Re-run with --apply after the compatible TrackFleet release is deployed.");
  process.exit(0);
}

// Neon HTTP transactions must be submitted together. The delete removes only
// duplicate observations for the same physical truck and exact provider
// timestamp; the update then canonicalizes the surviving telemetry keys.
await sql.transaction([
  sql`DELETE FROM fleet_position_observations current_row
      USING fleet_position_observations keeper
      WHERE current_row.company_id = keeper.company_id
        AND current_row.vehicle_name = keeper.vehicle_name
        AND current_row.position_at = keeper.position_at
        AND current_row.vehicle_id > keeper.vehicle_id`,
  sql`UPDATE fleet_position_observations
      SET vehicle_id = 'physical:' || lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))
      WHERE trim(vehicle_name) <> ''
        AND vehicle_id <> 'physical:' || lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))`,
]);

const after = await sql.query(`
  SELECT count(*)::int AS total_rows,
         count(DISTINCT vehicle_name)::int AS physical_names,
         count(DISTINCT vehicle_id)::int AS canonical_ids
  FROM fleet_position_observations
`);
console.log(JSON.stringify({ after: after[0] }, null, 2));
