import { runtimeEnv } from "trackfleet-runtime-env";
import { knownSites } from "./known-sites";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

function db() {
  if (!runtimeEnv.DB) throw new Error("D1 database binding is missing");
  return runtimeEnv.DB;
}

async function ensureSchema() {
  await db().prepare(`CREATE TABLE IF NOT EXISTS sites (
    company_id text NOT NULL,
    id text NOT NULL,
    label text NOT NULL,
    city text NOT NULL,
    country text NOT NULL,
    address text NOT NULL,
    latitude real,
    longitude real,
    arrival_radius_km real NOT NULL DEFAULT 0.5,
    roles text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    PRIMARY KEY (company_id, id)
  )`).run();
}

function hydrate(row: any): CompanySite {
  return {
    companyId: row.company_id,
    id: row.id,
    label: row.label,
    city: row.city,
    country: row.country,
    address: row.address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    arrivalRadiusKm: Number(row.arrival_radius_km),
    roles: JSON.parse(row.roles),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

async function seed(companyId: string) {
  await ensureSchema();
  const now = Date.now();
  for (const site of knownSites) {
    await db().prepare(`INSERT OR IGNORE INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId, site.id, site.label, site.city, site.country, site.address, site.latitude, site.longitude, site.arrivalRadiusKm, JSON.stringify(site.roles), now, now).run();
  }
}

export const siteStore: SiteStore = {
  async listForCompany(companyId) {
    await seed(companyId);
    const result = await db().prepare("SELECT * FROM sites WHERE company_id=? ORDER BY label").bind(companyId).all();
    return (result.results ?? []).map(hydrate);
  },
  async upsert(input: CreateCompanySiteInput) {
    await ensureSchema();
    const now = Date.now();
    await db().prepare(`INSERT INTO sites (company_id,id,label,city,country,address,latitude,longitude,arrival_radius_km,roles,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(company_id,id) DO UPDATE SET label=excluded.label,city=excluded.city,country=excluded.country,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,arrival_radius_km=excluded.arrival_radius_km,roles=excluded.roles,updated_at=excluded.updated_at`)
      .bind(input.companyId,input.id,input.label,input.city,input.country,input.address,input.latitude,input.longitude,input.arrivalRadiusKm,JSON.stringify(input.roles),now,now).run();
    const row = await db().prepare("SELECT * FROM sites WHERE company_id=? AND id=?").bind(input.companyId,input.id).first();
    if (!row) throw new Error("site_write_failed");
    return hydrate(row);
  },
};
