export type OriginPreferenceCompany = { account: string; user: string };

export function originPreferenceKey(company: OriginPreferenceCompany) {
  return `trackfleet-default-origin:${encodeURIComponent(company.account.toLowerCase())}:${encodeURIComponent(company.user.toLowerCase())}`;
}

export function resolvePreferredOriginSite(saved: string | null, availableOriginIds: string[], current = "") {
  if (saved && availableOriginIds.includes(saved)) return saved;
  if (current && availableOriginIds.includes(current)) return current;
  return availableOriginIds[0] ?? "";
}
