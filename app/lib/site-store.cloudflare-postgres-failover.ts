import { runtimeEnv } from "trackfleet-runtime-env";
import { siteStore as primarySiteStore } from "./site-store.shared-postgres";
import { withD1ReadFailover } from "./d1-read-failover";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
};

function d1() {
  const binding = (runtimeEnv as unknown as { DB?: D1Binding }).DB;
  if (!binding) throw new Error("D1 database binding is missing");
  return binding;
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

async function listStandbySites(companyId: string) {
  const result = await d1().prepare("SELECT * FROM sites WHERE company_id = ? ORDER BY label")
    .bind(companyId)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(hydrate);
}

export const siteStore: SiteStore = {
  listForCompany(companyId: string) {
    return withD1ReadFailover(
      "site.listForCompany",
      () => primarySiteStore.listForCompany(companyId),
      () => listStandbySites(companyId),
    );
  },
  upsert(input: CreateCompanySiteInput) {
    return primarySiteStore.upsert(input);
  },
};
