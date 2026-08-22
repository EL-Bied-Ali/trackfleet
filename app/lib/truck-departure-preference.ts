export type TruckDeparturePreferenceCompany = { account: string; user: string };

// Most new parcels entered around the same time are waiting on the same
// next relay truck, so re-typing the same departure date/time for every one
// is pure friction -- this remembers the last value entered so the creation
// form can pre-fill it, the same way originPreferenceKey remembers the last
// origin site.
export function truckDeparturePreferenceKey(company: TruckDeparturePreferenceCompany) {
  return `trackfleet-next-truck-departure:${encodeURIComponent(company.account.toLowerCase())}:${encodeURIComponent(company.user.toLowerCase())}`;
}
