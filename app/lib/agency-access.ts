import { knownSite } from "./known-sites.ts";

export const agencyUserPrefix = "agency:";
export const maximumAgencyLocationAccuracyMeters = 100;

export function agencySiteIdFromUserLabel(userLabel: string) {
  if (!userLabel.startsWith(agencyUserPrefix)) return null;
  const siteId = userLabel.slice(agencyUserPrefix.length);
  return knownSite(siteId) ? siteId : null;
}

export function agencyBrowserLocationIsAcceptable(input: {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}) {
  return Number.isFinite(input.latitude)
    && Number.isFinite(input.longitude)
    && input.latitude >= -90
    && input.latitude <= 90
    && input.longitude >= -180
    && input.longitude <= 180
    && Number.isFinite(input.accuracyMeters)
    && input.accuracyMeters > 0
    && input.accuracyMeters <= maximumAgencyLocationAccuracyMeters;
}

export function agencyDeliveryIsVisible(delivery: { originSiteId: string | null; destinationSiteId: string | null }, siteId: string) {
  return delivery.originSiteId === siteId || delivery.destinationSiteId === siteId;
}
