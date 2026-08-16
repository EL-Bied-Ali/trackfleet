import { knownSites } from "./known-sites";
import type { CompanySite, CreateCompanySiteInput, SiteStore } from "./site-store.types";

const rows = new Map<string, CompanySite>();

function seedForCompany(companyId: string) {
  const now = new Date();
  for (const site of knownSites) {
    const key = `${companyId}:${site.id}`;
    if (!rows.has(key)) rows.set(key, { ...site, companyId, createdAt: now, updatedAt: now });
  }
}

export const memorySiteStore: SiteStore = {
  async listForCompany(companyId) {
    seedForCompany(companyId);
    return [...rows.values()].filter((row) => row.companyId === companyId).sort((a, b) => a.label.localeCompare(b.label));
  },
  async upsert(input: CreateCompanySiteInput) {
    seedForCompany(input.companyId);
    const key = `${input.companyId}:${input.id}`;
    const existing = rows.get(key);
    const now = new Date();
    const row: CompanySite = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    rows.set(key, row);
    return row;
  },
};
