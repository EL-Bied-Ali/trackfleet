import { runtimeEnv } from "trackfleet-runtime-env";
import { knownSites } from "./known-sites";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

function db() {
  if (!runtimeEnv.DB) throw new Error("D1 database binding is missing");
  return runtimeEnv.DB;
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
    whatsapp: row.whatsapp === null || row.whatsapp === undefined ? null : String(row.whatsapp),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

async function seed(companyId: string) {
  const now = Date.now();
  for (const site of knownSites) {
    await db().prepare(`INSERT OR IGNORE INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,whatsapp,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId, site.id, site.label, site.city, site.country, site.address, site.latitude, site.longitude, site.arrivalRadiusKm, JSON.stringify(site.roles), site.whatsapp ?? null, now, now).run();
  }
}

export const siteStore: SiteStore = {
  async listForCompany(companyId) {
    await seed(companyId);
    const result = await db().prepare("SELECT * FROM sites WHERE company_id=? ORDER BY label").bind(companyId).all();
    return (result.results ?? []).map((row) => hydrate(row as Record<string, unknown>));
  },
  async upsert(input: CreateCompanySiteInput) {
    const now = Date.now();
    await db().prepare(`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,whatsapp,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(company_id,id) DO UPDATE SET label=excluded.label,city=excluded.city,country=excluded.country,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,arrival_radius_km=excluded.arrival_radius_km,roles=excluded.roles,whatsapp=excluded.whatsapp,updated_at=excluded.updated_at`)
      .bind(input.companyId,input.id,input.label,input.city,input.country,input.address,input.latitude,input.longitude,input.arrivalRadiusKm,JSON.stringify(input.roles),input.whatsapp ?? null,now,now).run();
    const row = await db().prepare("SELECT * FROM sites WHERE company_id=? AND id=?").bind(input.companyId,input.id).first();
    if (!row) throw new Error("site_write_failed");
    return hydrate(row as Record<string, unknown>);
  },
};
