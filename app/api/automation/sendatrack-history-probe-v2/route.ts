import { runtimeEnv } from "trackfleet-runtime-env";
import { probeSendatrackHistory } from "../../../lib/sendatrack-history-live";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const result = await probeSendatrackHistory(24);
  console.info("[trackfleet:sendatrack-history-probe] summary", {
    ok: result.ok,
    status: result.status,
    contentType: result.contentType,
    pointCount: result.pointCount,
    firstTimestamp: result.firstTimestamp,
    lastTimestamp: result.lastTimestamp,
    payloadKeys: result.payloadKeys,
    providerError: result.providerError ?? null,
    error: result.error ?? null,
  });
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
