import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { getCompanySession } from "../../lib/company-auth";
import { applyVehicleAliases } from "../../lib/vehicle-alias-apply";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  const rawSnapshot = await getSendatrackSnapshot(session.credentials);
  const snapshot = await applyVehicleAliases(rawSnapshot, session.companyId);
  return Response.json({
    configured: snapshot.configured,
    connected: snapshot.connected,
    error: snapshot.error ?? null,
    vehicles: snapshot.vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
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
