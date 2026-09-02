import { getSqlOrNull } from "./pg-client.ts";
import { knownSites } from "./known-sites.ts";
import {
  computeManualArrivalDurationEstimates,
  MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE,
  type ManualArrivalDurationEstimate,
  type ManualArrivalDurationSample,
} from "./manual-arrival-duration.ts";

export type { ManualArrivalDurationEstimate } from "./manual-arrival-duration.ts";

const relaySiteIds = knownSites
  .filter((site) => site.finalLegTrackingUnavailable === true && typeof site.relayHubSiteId === "string")
  .map((site) => site.id);

// Distinct from getManualArrivalDurationEstimates (manual-arrival-duration.
// postgres.ts), which isolates just the untracked relay-hub-to-destination
// leg using GPS proximity to the hub -- useful once a truck is actually
// moving. The creation form and schedule editor need an estimate before
// that: given only a dispatcher-entered departure date and a destination,
// "when will it probably arrive", door to door. This measures the full
// dispatcher-entered-departure-to-confirmed-arrival duration per
// destination site instead, reusing the same recency-bounded median math
// (computeManualArrivalDurationEstimates) with a different, much cheaper
// query -- no GPS position join needed, since both ends of the window are
// already plain delivery/event timestamps.
export async function getDepartureArrivalDurationEstimates(companyId: string): Promise<Map<string, ManualArrivalDurationEstimate>> {
  if (!relaySiteIds.length) return new Map();
  const sql = getSqlOrNull();
  if (!sql) return new Map();

  const rows = await sql`
    WITH ranked AS (
      SELECT
        d.destination_site_id,
        arrival.created_at AS arrived_at,
        d.next_truck_departure_at AS started_at,
        ROW_NUMBER() OVER (PARTITION BY d.destination_site_id ORDER BY arrival.created_at DESC) AS recency_rank
      FROM deliveries d
      JOIN delivery_events arrival ON arrival.delivery_id = d.id AND arrival.type = 'MANUAL_ARRIVAL_CONFIRMED'
      WHERE d.company_id = ${companyId}
        AND d.destination_site_id = ANY(${relaySiteIds}::text[])
        AND d.next_truck_departure_at IS NOT NULL
    )
    SELECT destination_site_id, arrived_at, started_at
    FROM ranked
    WHERE recency_rank <= ${MANUAL_ARRIVAL_SAMPLE_SIZE_PER_SITE}
  ` as { destination_site_id: string; arrived_at: string | Date; started_at: string | Date }[];

  const samples: ManualArrivalDurationSample[] = rows.map((row) => ({
    destinationSiteId: row.destination_site_id,
    arrivedAt: new Date(row.arrived_at),
    startedAt: new Date(row.started_at),
  }));
  return computeManualArrivalDurationEstimates(samples);
}
