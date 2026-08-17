import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot } from "../../../lib/sendatrack";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  const user = runtimeEnv.SENDATRACK_USER?.trim() ?? "";
  if (!accountID || !user) {
    return Response.json({ error: "sendatrack_not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const snapshot = await getSendatrackSnapshot({
    accountID,
    user,
    password: `trackfleet-intentionally-wrong-${Date.now()}`,
  });

  return Response.json({
    configured: snapshot.configured,
    connected: snapshot.connected,
    error: snapshot.error ?? null,
  }, { headers: { "cache-control": "no-store" } });
}
