import postgres from "postgres";
import { inferSiteCoordinateSuggestions } from "../app/lib/site-coordinate-inference.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const applyHighConfidence = process.argv.includes("--apply-high-confidence");
const sql = postgres(databaseUrl, { max: 1 });

const siteRows = await sql`SELECT id, label, city, address, country, latitude, longitude
  FROM sites ORDER BY label ASC`;
const observationRows = await sql`SELECT vehicle_name, latitude, longitude, speed, address, position_at
  FROM fleet_position_observations
  WHERE position_at >= NOW() - INTERVAL '14 days'
  ORDER BY position_at ASC
  LIMIT 50000`;

const sites = siteRows.map((row) => ({
  id: String(row.id),
  label: String(row.label),
  city: String(row.city),
  address: String(row.address),
  country: String(row.country),
}));
const observations = observationRows.map((row) => ({
  vehicleName: String(row.vehicle_name),
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  speed: Number(row.speed),
  address: String(row.address ?? ""),
  positionAt: new Date(String(row.position_at)),
}));

const suggestions = inferSiteCoordinateSuggestions(sites, observations);
const existingCoordinates = new Map(siteRows.map((row) => [String(row.id), row.latitude != null && row.longitude != null]));
const report = suggestions.map((suggestion) => ({
  ...suggestion,
  existingCoordinates: existingCoordinates.get(suggestion.siteId) === true,
  autoApplicable: suggestion.confidence === "high"
    && suggestion.latitude !== null
    && suggestion.longitude !== null
    && existingCoordinates.get(suggestion.siteId) !== true,
}));
console.log(JSON.stringify({ mode: applyHighConfidence ? "apply-high-confidence" : "dry-run", suggestions: report }, null, 2));

if (!applyHighConfidence) {
  console.log("Dry run only. Medium/low suggestions are never written automatically.");
  await sql.end();
  process.exit(0);
}

const applicable = report.filter((suggestion) => suggestion.autoApplicable);
if (!applicable.length) {
  console.log("No high-confidence missing site coordinates to apply.");
  await sql.end();
  process.exit(0);
}

await sql.begin(async (sql) => {
  for (const suggestion of applicable) {
    await sql`
      UPDATE sites
      SET latitude = ${suggestion.latitude}, longitude = ${suggestion.longitude}
      WHERE id = ${suggestion.siteId}
        AND latitude IS NULL
        AND longitude IS NULL
    `;
  }
});
console.log(`Applied ${applicable.length} high-confidence site coordinate suggestion(s).`);
await sql.end();
