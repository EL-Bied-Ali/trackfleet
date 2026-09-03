import { getSql } from "./pg-client.ts";
import { knownSites } from "./known-sites";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

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
    whatsapp: row.whatsapp === null || row.whatsapp === undefined ? null : String(row.whatsapp),
    color: row.color === null || row.color === undefined ? null : String(row.color),
    shortCodePrefix: row.short_code_prefix === null || row.short_code_prefix === undefined ? null : String(row.short_code_prefix),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

async function seed(companyId: string) {
  // Production schema is provisioned separately. Seed all known sites in a
  // single request instead of one Cloudflare subrequest per site.
  const sql = getSql();
  const seedRows = knownSites.map((site) => ({
    id: site.id,
    label: site.label,
    city: site.city,
    country: site.country,
    address: site.address,
    latitude: site.latitude,
    longitude: site.longitude,
    arrival_radius_km: site.arrivalRadiusKm,
    roles: JSON.stringify(site.roles),
    whatsapp: site.whatsapp ?? null,
    color: site.color ?? null,
    short_code_prefix: site.shortCodePrefix ?? null,
  }));

  await sql`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,whatsapp,color,short_code_prefix)
    SELECT ${companyId}, seed.id, seed.label, seed.city, seed.country, seed.address,
      seed.latitude, seed.longitude, seed.arrival_radius_km, seed.roles, seed.whatsapp, seed.color, seed.short_code_prefix
    FROM json_to_recordset(${sql.json(seedRows)}::json) AS seed(
      id text,
      label text,
      city text,
      country text,
      address text,
      latitude double precision,
      longitude double precision,
      arrival_radius_km double precision,
      roles text,
      whatsapp text,
      color text,
      short_code_prefix text
    )
    ON CONFLICT (company_id,id) DO NOTHING`;
}

export const postgresSiteStore: SiteStore = {
  async listForCompany(companyId) {
    await seed(companyId);
    const sql = getSql();
    const rows = await sql`SELECT * FROM sites WHERE company_id=${companyId} ORDER BY label`;
    return rows.map((row) => hydrate(row as Record<string, unknown>));
  },
  async upsert(input: CreateCompanySiteInput) {
    const sql = getSql();
    const rows = await sql`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,whatsapp,color,short_code_prefix,updated_at)
      VALUES (${input.companyId},${input.id},${input.label},${input.city},${input.country},${input.address},${input.latitude},${input.longitude},${input.arrivalRadiusKm},${JSON.stringify(input.roles)},${input.whatsapp ?? null},${input.color ?? null},${input.shortCodePrefix ?? null},now())
      ON CONFLICT (company_id,id) DO UPDATE SET label=excluded.label,city=excluded.city,country=excluded.country,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,arrival_radius_km=excluded.arrival_radius_km,roles=excluded.roles,whatsapp=excluded.whatsapp,color=excluded.color,short_code_prefix=excluded.short_code_prefix,updated_at=now()
      RETURNING *`;
    return hydrate(rows[0] as Record<string, unknown>);
  },
  async remove(companyId, id) {
    const sql = getSql();
    const rows = await sql`DELETE FROM sites WHERE company_id=${companyId} AND id=${id} RETURNING id`;
    return rows.length > 0;
  },
};
