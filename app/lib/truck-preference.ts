export type TruckPreferenceCompany = { account: string; user: string };

export function truckPreferenceKey(company: TruckPreferenceCompany) {
  return `trackfleet-default-truck:${encodeURIComponent(company.account.toLowerCase())}:${encodeURIComponent(company.user.toLowerCase())}`;
}

// Unlike origin site (always required, so it falls back to the first
// available one), a truck is optional at creation -- a saved vehicle that's
// no longer connected simply falls back to unassigned rather than picking
// an arbitrary different truck.
export function resolvePreferredTruck(saved: string | null, availableVehicleIds: string[]) {
  if (saved && availableVehicleIds.includes(saved)) return saved;
  return "";
}
