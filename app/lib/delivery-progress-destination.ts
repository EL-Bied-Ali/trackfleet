import { knownSite } from "./known-sites.ts";

// GPS-tracked trucks never physically reach a relay-only destination (see
// KnownSite.finalLegTrackingUnavailable) -- confirmed from real fleet GPS
// history, CTM (or another local carrier) takes over from the confirmed hub
// (Casablanca or the Tanger Med ferry crossing). Computing route/progress
// metrics against the delivery's actual final destination would keep
// counting distance the truck never drives, so the progress % would either
// understate the real, GPS-tracked leg or never cleanly reach 100% without a
// manual/CTM confirmation. Route/progress math should stop at the hub
// instead -- the remaining leg is estimated separately from confirmed
// arrivals (manualArrivalEstimateHours, see eta-display.ts and
// manual-arrival-duration.postgres.ts), not by pretending GPS still applies
// past the hub.
export function progressRouteDestination(input: {
  destination: string;
  destinationSiteId: string | null | undefined;
  explicitDestination: [number, number] | null;
}): { destination: string; explicitDestination: [number, number] | null } {
  const site = knownSite(input.destinationSiteId);
  if (!site?.finalLegTrackingUnavailable || !site.relayHubSiteId) {
    return { destination: input.destination, explicitDestination: input.explicitDestination };
  }
  const hub = knownSite(site.relayHubSiteId);
  if (!hub) return { destination: input.destination, explicitDestination: input.explicitDestination };
  const hubPoint: [number, number] | null = typeof hub.latitude === "number" && typeof hub.longitude === "number"
    ? [hub.longitude, hub.latitude]
    : null;
  return { destination: hub.address, explicitDestination: hubPoint };
}
