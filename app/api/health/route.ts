import { isSendatrackConfigured } from "../../lib/sendatrack";

export async function GET() {
  return Response.json({
    ok: true,
    service: "trackfleet",
    sendatrackConfigured: isSendatrackConfigured(),
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
