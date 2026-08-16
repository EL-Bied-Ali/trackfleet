import { runtimeEnv } from "trackfleet-runtime-env";
import { runFleetAutomation } from "../../../lib/server-automation";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = await runFleetAutomation(new URL(request.url).origin);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "automation_failed";
    console.error("[trackfleet:automation] tick failed", { message });
    return Response.json({ ok: false, error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
