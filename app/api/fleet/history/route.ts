import { store } from "trackfleet-delivery-store";
import { siteStore } from "trackfleet-site-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { reconstructFleetTrips } from "../../../lib/fleet-trip-reconstruction";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseLimit(value: string | null) {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(parsed)));
}

function error(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const session = await getDispatcherSession(request);
  if (!session) return error("authentication_required", 401);

  const url = new URL(request.url);
  const vehicleId = url.searchParams.get("vehicleId")?.trim() ?? "";
  if (!vehicleId || vehicleId.length > 100 || !/^[a-zA-Z0-9._:-]+$/.test(vehicleId)) {
    return error("valid_vehicle_id_required", 400);
  }

  const toParam = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from");
  const to = toParam ? parseDate(toParam) : new Date();
  if (!to) return error("invalid_to", 400);
  const from = fromParam ? parseDate(fromParam) : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (!from) return error("invalid_from", 400);
  if (from.getTime() > to.getTime()) return error("invalid_window", 400);
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) return error("window_too_large", 400);

  const limit = parseLimit(url.searchParams.get("limit"));
  const newestRows = await store.listFleetPositions(session.companyId, vehicleId, MAX_LIMIT);
  const inWindow = newestRows.filter((row) => {
    const timestamp = row.positionAt.getTime();
    return timestamp >= from.getTime() && timestamp <= to.getTime();
  });
  const truncated = inWindow.length > limit;
  const selected = inWindow.slice(0, limit);
  const sites = await siteStore.listForCompany(session.companyId);
  const reconstruction = reconstructFleetTrips(selected, sites);

  const points = reconstruction.points.map((point) => ({
    vehicleId: point.vehicleId,
    vehicleName: point.vehicleName,
    positionAt: point.positionAt.toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    speed: point.speed,
    heading: point.heading,
    address: point.address,
  }));
  const stops = reconstruction.stops.map((stop) => ({
    ...stop,
    startedAt: stop.startedAt.toISOString(),
    endedAt: stop.endedAt.toISOString(),
  }));
  const trips = reconstruction.trips.map((trip) => ({
    ...trip,
    startedAt: trip.startedAt.toISOString(),
    endedAt: trip.endedAt.toISOString(),
  }));

  return Response.json({
    vehicle: {
      id: vehicleId,
      name: reconstruction.points.at(-1)?.vehicleName ?? null,
    },
    window: { from: from.toISOString(), to: to.toISOString() },
    truncated,
    points,
    stops,
    trips,
    summary: {
      ...reconstruction.summary,
      startedAt: reconstruction.summary.startedAt?.toISOString() ?? null,
      endedAt: reconstruction.summary.endedAt?.toISOString() ?? null,
    },
  }, { headers: { "cache-control": "no-store" } });
}
