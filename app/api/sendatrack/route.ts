import { getSendatrackSnapshot } from "../../lib/sendatrack";
import { getCompanySession } from "../../lib/company-auth";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  const snapshot = await getSendatrackSnapshot(session.credentials);
  return Response.json({
    configured: snapshot.configured,
    connected: snapshot.connected,
    error: snapshot.error ?? null,
    vehicles: snapshot.vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      speed: vehicle.speed,
      updatedAt: vehicle.updatedAt,
    })),
  }, {
    status: snapshot.configured && !snapshot.connected ? 502 : 200,
    headers: { "cache-control": "no-store" },
  });
}
