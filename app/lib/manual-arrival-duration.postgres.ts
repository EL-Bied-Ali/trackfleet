import { getSqlOrNull } from "./pg-client.ts";
import { knownSites, type KnownSite } from "./known-sites.ts";
import {
  computeManualArrivalDurationEstimates,
  resolveManualArrivalSamples,
  MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE,
  type ManualArrivalDurationEstimate,
  type RelayHubConfig,
  type RelayPassageCandidate,
} from "./manual-arrival-duration.ts";

export type { ManualArrivalDurationEstimate } from "./manual-arrival-duration.ts";

type RawRow = {
  delivery_id: string;
  destination_site_id: string;
  arrived_at: string | Date;
  fallback_started_at: string | Date;
  position_at: string | Date | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

// How far from the relay hub's confirmed coordinates a GPS ping still counts
// as "the truck was at the relay" -- wider than the hub's own tight arrival
// geofence (built for precise automatic arrival detection) since this only
// needs to catch "was in the vicinity", not confirm an exact stop. Mirrors
// the arrivalRadiusKm * 4 convention already used for NEAR_DESTINATION in
// delivery-events.ts.
function relayVicinityRadiusKm(hub: KnownSite) {
  return Math.max(2, hub.arrivalRadiusKm * 4);
}

const relaySites = knownSites.filter((site): site is KnownSite & { relayHubSiteId: string } =>
  site.finalLegTrackingUnavailable === true && typeof site.relayHubSiteId === "string");

// Employee-confirmed arrival duration per destination site, measured from
// the last GPS position seen near the relay hub (e.g. Casablanca -- see
// KnownSite.relayHubSiteId) to the MANUAL_ARRIVAL_CONFIRMED event. The
// GPS-tracked leg up to the relay already has a real GPS-based ETA; this
// isolates just the actually-unknown relay-to-destination leg, which is
// what a customer already at/past the relay actually wants to know.
export async function getManualArrivalDurationEstimates(companyId: string): Promise<Map<string, ManualArrivalDurationEstimate>> {
  if (!relaySites.length) return new Map();
  const sql = getSqlOrNull();
  if (!sql) return new Map();

  const relaySiteIds = relaySites.map((site) => site.id);
  const hubIds = [...new Set(relaySites.map((site) => site.relayHubSiteId))];

  // fleet_position_observations accumulates every GPS tick for a vehicle's
  // whole operational history. A delivery with no DEPARTED event falls back
  // to its (possibly days-old) created_at as the window start, so an
  // unbounded date-range join here can pull in tens of thousands of position
  // rows for a single candidate and blow the Worker's CPU budget. Bounding to
  // the most recent positions per delivery is safe: if final-leg tracking is
  // genuinely unavailable past the hub, GPS pings stop once the truck goes
  // off-grid, so the last-seen-near-hub ping is necessarily among the most
  // recent ones in the window, not buried under older history.
  //
  // 2000 (the original bound here) turned out to still be too generous:
  // reproduced live via wrangler tail hours after that fix shipped -- up to
  // MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE (10) candidates per relay site,
  // times up to 3 relay sites, times 2000 rows each is up to 60,000 GPS
  // position rows deserialized and mapped in JS for one /api/deliveries
  // request, which is real CPU-ms work regardless of how tight the SQL-side
  // filter is -- and was enough on its own to exceed the Worker's CPU
  // budget once enough real GPS history had accumulated. 150 is still very
  // generous for "last ping before going off-grid" and cuts the worst case
  // to 4,500 rows.
  const POSITION_ROWS_PER_DELIVERY = 150;
  const [hubRows, candidateRows] = await Promise.all([
    sql`SELECT id, latitude, longitude FROM sites WHERE company_id = ${companyId} AND id = ANY(${hubIds}::text[])`,
    sql`
      WITH ranked AS (
        SELECT
          d.id AS delivery_id,
          d.destination_site_id,
          d.sendatrack_vehicle_id,
          arrival.created_at AS arrived_at,
          COALESCE(departure.created_at, d.created_at) AS fallback_started_at,
          ROW_NUMBER() OVER (PARTITION BY d.destination_site_id ORDER BY arrival.created_at DESC) AS recency_rank
        FROM deliveries d
        JOIN delivery_events arrival ON arrival.delivery_id = d.id AND arrival.type = 'MANUAL_ARRIVAL_CONFIRMED'
        LEFT JOIN delivery_events departure ON departure.delivery_id = d.id AND departure.type = 'DEPARTED'
        WHERE d.company_id = ${companyId} AND d.destination_site_id = ANY(${relaySiteIds}::text[])
      ),
      targets AS (
        SELECT delivery_id, destination_site_id, sendatrack_vehicle_id, arrived_at, fallback_started_at
        FROM ranked
        WHERE recency_rank <= ${MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE}
      ),
      positions AS (
        SELECT
          t.delivery_id,
          fpo.position_at,
          fpo.latitude,
          fpo.longitude,
          ROW_NUMBER() OVER (PARTITION BY t.delivery_id ORDER BY fpo.position_at DESC) AS position_rank
        FROM targets t
        JOIN fleet_position_observations fpo
          ON fpo.company_id = ${companyId}
          AND fpo.vehicle_id = t.sendatrack_vehicle_id
          AND fpo.position_at >= t.fallback_started_at
          AND fpo.position_at <= t.arrived_at
      )
      SELECT t.delivery_id, t.destination_site_id, t.arrived_at, t.fallback_started_at, p.position_at, p.latitude, p.longitude
      FROM targets t
      LEFT JOIN positions p ON p.delivery_id = t.delivery_id AND p.position_rank <= ${POSITION_ROWS_PER_DELIVERY}
    `,
  ]) as unknown as [Array<{ id: string; latitude: number | string | null; longitude: number | string | null }>, RawRow[]];

  const hubCoordsById = new Map(
    hubRows
      .filter((row) => row.latitude !== null && row.longitude !== null)
      .map((row) => [row.id, { longitude: Number(row.longitude), latitude: Number(row.latitude) }]),
  );

  const hubConfigByDestination = new Map<string, RelayHubConfig>();
  for (const site of relaySites) {
    const hub = knownSites.find((candidate) => candidate.id === site.relayHubSiteId);
    const coords = hubCoordsById.get(site.relayHubSiteId);
    if (!hub || !coords) continue;
    hubConfigByDestination.set(site.id, {
      hubLongitude: coords.longitude,
      hubLatitude: coords.latitude,
      vicinityRadiusKm: relayVicinityRadiusKm(hub),
    });
  }

  const candidates: RelayPassageCandidate[] = candidateRows.map((row) => ({
    deliveryId: row.delivery_id,
    destinationSiteId: row.destination_site_id,
    arrivedAt: new Date(row.arrived_at),
    fallbackStartedAt: new Date(row.fallback_started_at),
    positionAt: row.position_at === null ? null : new Date(row.position_at),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  }));

  const samples = resolveManualArrivalSamples(candidates, hubConfigByDestination);
  return computeManualArrivalDurationEstimates(samples);
}
