import "./postgres-runtime-bootstrap";
import { runtimeEnv } from "trackfleet-runtime-env";
import { siteStore as primarySiteStore } from "./site-store.vercel";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

type D1MirrorStatement = {
  bind(...values: unknown[]): D1MirrorStatement;
  run(): Promise<unknown>;
};

type D1MirrorBinding = {
  prepare(query: string): D1MirrorStatement;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1MirrorBinding }).DB ?? null;
}

async function mirrorSite(site: CompanySite) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare(`INSERT INTO sites (
      company_id, id, label, city, country, address, latitude, longitude, arrival_radius_km, roles, whatsapp, color, short_code_prefix, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, id) DO UPDATE SET
      label = excluded.label,
      city = excluded.city,
      country = excluded.country,
      address = excluded.address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      arrival_radius_km = excluded.arrival_radius_km,
      roles = excluded.roles,
      whatsapp = excluded.whatsapp,
      color = excluded.color,
      short_code_prefix = excluded.short_code_prefix,
      updated_at = excluded.updated_at`)
      .bind(
        site.companyId,
        site.id,
        site.label,
        site.city,
        site.country,
        site.address,
        site.latitude,
        site.longitude,
        site.arrivalRadiusKm,
        JSON.stringify(site.roles),
        site.whatsapp ?? null,
        site.color ?? null,
        site.shortCodePrefix ?? null,
        site.createdAt.getTime(),
        site.updatedAt.getTime(),
      )
      .run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 site mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
      companyId: site.companyId,
      siteId: site.id,
    });
  }
}

export const siteStore: SiteStore = {
  listForCompany(companyId: string) {
    return primarySiteStore.listForCompany(companyId);
  },
  async upsert(input: CreateCompanySiteInput) {
    const site = await primarySiteStore.upsert(input);
    await mirrorSite(site);
    return site;
  },
};
