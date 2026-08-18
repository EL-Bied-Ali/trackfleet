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
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
