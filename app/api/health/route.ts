import { isSendatrackConfigured } from "../../lib/sendatrack";
import { getStorageHealth } from "../../lib/storage-health";

export async function GET() {
  const storage = await getStorageHealth();
  return Response.json({
    ok: storage.connected,
    service: "trackfleet",
    sendatrackConfigured: isSendatrackConfigured(),
    storage,
    timestamp: new Date().toISOString(),
  }, {
    status: storage.connected ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
