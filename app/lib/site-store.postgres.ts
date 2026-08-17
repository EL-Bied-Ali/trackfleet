import { neon } from "@neondatabase/serverless";
import { knownSites } from "./known-sites";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres site store");
const sql = neon(databaseUrl);
let schemaPromise: Promise<void> | null = null;

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS sites (
      company_id text NOT NULL,
      id text NOT NULL,
      label text NOT NULL,
      city text NOT NULL,
      country text NOT NULL,
      address text NOT NULL,
      latitude double precision,
      longitude double precision,
      arrival_radius_km double precision NOT NULL DEFAULT 0.5,
      roles text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, id)
    )`;
  })();
  return schemaPromise;
}

function hydrate(row: Record<string, unknown>): CompanySite {
  return {
    companyId: String(row.company_id),
    id: String(row.id),
    label: String(row.label),
    city: String(row.city),
    country: String(row.country) as "BE" | "MA",
    address: String(row.address),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    arrivalRadiusKm: Number(row.arrival_radius_km),
    roles: JSON.parse(String(row.roles)) as CompanySite["roles"],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

async function seed(companyId: string) {
  await ensureSchema();
  for (const site of knownSites) {
    await sql`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles)
      VALUES (${companyId},${site.id},${site.label},${site.city},${site.country},${site.address},${site.latitude},${site.longitude},${site.arrivalRadiusKm},${JSON.stringify(site.roles)})
      ON CONFLICT (company_id,id) DO NOTHING`;
  }
}

export const postgresSiteStore: SiteStore = {
  async listForCompany(companyId) {
    await seed(companyId);
    const rows = await sql`SELECT * FROM sites WHERE company_id=${companyId} ORDER BY label`;
    return rows.map((row) => hydrate(row as Record<string, unknown>));
  },
  async upsert(input: CreateCompanySiteInput) {
    await ensureSchema();
    const rows = await sql`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,updated_at)
      VALUES (${input.companyId},${input.id},${input.label},${input.city},${input.country},${input.address},${input.latitude},${input.longitude},${input.arrivalRadiusKm},${JSON.stringify(input.roles)},now())
      ON CONFLICT (company_id,id) DO UPDATE SET label=excluded.label,city=excluded.city,country=excluded.country,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,arrival_radius_km=excluded.arrival_radius_km,roles=excluded.roles,updated_at=now()
      RETURNING *`;
    return hydrate(rows[0] as Record<string, unknown>);
  },
};
