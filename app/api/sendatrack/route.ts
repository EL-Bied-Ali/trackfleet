import { getSendatrackSnapshot } from "../../lib/sendatrack";

export async function GET() {
  const snapshot = await getSendatrackSnapshot();
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
