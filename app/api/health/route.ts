import { isSendatrackConfigured } from "../../lib/sendatrack";

export async function GET() {
  return Response.json({
    ok: true,
    service: "trackfleet",
    sendatrackConfigured: isSendatrackConfigured(),
    storage: process.env.DATABASE_URL?.trim() ? "postgres" : process.env.CF_PAGES ? "cloudflare-d1" : "memory",
    persistentStorageConfigured: Boolean(process.env.DATABASE_URL?.trim() || process.env.CF_PAGES),
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
