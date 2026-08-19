import { runtimeEnv } from "trackfleet-runtime-env";
import { reconcileD1Telemetry } from "../../../lib/d1-telemetry-reconciliation";

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
    const result = await reconcileD1Telemetry();
    return Response.json({ ok: result.ran, reconciliation: result }, {
      status: result.ran ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "telemetry_reconciliation_failed";
    console.error("[trackfleet:replication] D1 telemetry reconciliation failed", { message });
    return Response.json({ ok: false, error: "telemetry_reconciliation_failed" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
