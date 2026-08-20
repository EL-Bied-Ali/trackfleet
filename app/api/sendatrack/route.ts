import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { getCompanySession } from "../../lib/company-auth";
import { vehicleAliasStore } from "trackfleet-vehicle-alias-store";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  const [snapshot, vehicleAliases] = await Promise.all([
    getSendatrackSnapshot(session.credentials),
    vehicleAliasStore.listForCompany(session.companyId),
  ]);
  const vehicleAliasById = new Map(vehicleAliases.map((row) => [row.sendatrackVehicleId, row.alias]));
  return Response.json({
    configured: snapshot.configured,
    connected: snapshot.connected,
    error: snapshot.error ?? null,
    vehicles: snapshot.vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: vehicleAliasById.get(vehicle.id) ?? vehicle.name,
      speed: vehicle.speed,
      updatedAt: vehicle.updatedAt,
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
    })),
  }, {
    status: snapshot.configured && !snapshot.connected ? 502 : 200,
    headers: { "cache-control": "no-store" },
  });
}
