import { runtimeEnv } from "trackfleet-runtime-env";
import { backfillD1DeliveryHistory } from "../../../lib/d1-history-backfill";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = await backfillD1DeliveryHistory();
    return Response.json({ ok: result.ran, backfill: result }, {
      status: result.ran ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "history_backfill_failed";
    console.error("[trackfleet:replication] D1 history backfill failed", { message });
    return Response.json({ ok: false, error: "history_backfill_failed" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
