import type { CompanySite } from "./site-store.types.ts";

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findCompanySiteByText(companySites: CompanySite[], value: string) {
  const wanted = normalized(value);
  if (!wanted) return null;
  return companySites.find((candidate) => candidate.id === value)
    ?? companySites.find((candidate) => [candidate.label, candidate.city, candidate.address].some((entry) => normalized(entry) === wanted))
    ?? null;
}

export function resolveExplicitCompanySite(companySites: CompanySite[], siteId: string) {
  const requestedId = siteId.trim();
  if (!requestedId) return { site: null, invalid: false } as const;
  const site = companySites.find((candidate) => candidate.id === requestedId) ?? null;
  return { site, invalid: site === null } as const;
}
