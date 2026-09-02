import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply");
const sql = postgres(databaseUrl, { max: 1 });

const summary = await sql`
  WITH groups AS (
    SELECT company_id,
           lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g')) AS physical_key,
           position_at,
           count(*) AS copies
    FROM fleet_position_observations
    WHERE trim(vehicle_name) <> ''
    GROUP BY company_id, physical_key, position_at
  )
  SELECT
    (SELECT count(*) FROM fleet_position_observations)::int AS total_rows,
    (SELECT count(DISTINCT lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))) FROM fleet_position_observations)::int AS physical_names,
    (SELECT count(DISTINCT vehicle_id) FROM fleet_position_observations)::int AS source_ids,
    coalesce(sum(GREATEST(copies - 1, 0)), 0)::int AS duplicate_rows
  FROM groups
`;
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", before: summary[0] }, null, 2));

if (!apply) {
  console.log("Dry run only. Re-run with --apply after the compatible TrackFleet release is deployed.");
  process.exit(0);
}

// The delete removes only duplicate observations for the same normalized physical truck and exact
// provider timestamp; the update then canonicalizes the surviving telemetry keys. Run inside one
// transaction so a failure partway through can't leave the table in a half-canonicalized state.
await sql.begin(async (sql) => {
  await sql`DELETE FROM fleet_position_observations current_row
      USING fleet_position_observations keeper
      WHERE current_row.company_id = keeper.company_id
        AND lower(regexp_replace(current_row.vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))
          = lower(regexp_replace(keeper.vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))
        AND current_row.position_at = keeper.position_at
        AND current_row.vehicle_id > keeper.vehicle_id`;
  await sql`UPDATE fleet_position_observations
      SET vehicle_id = 'physical:' || lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))
      WHERE trim(vehicle_name) <> ''
        AND vehicle_id <> 'physical:' || lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g'))`;
});

const after = await sql`
  SELECT count(*)::int AS total_rows,
         count(DISTINCT lower(regexp_replace(vehicle_name, '[^a-zA-Z0-9]+', '', 'g')))::int AS physical_names,
         count(DISTINCT vehicle_id)::int AS canonical_ids
  FROM fleet_position_observations
`;
console.log(JSON.stringify({ after: after[0] }, null, 2));
