import { runtimeEnv } from "trackfleet-runtime-env";
import { automationStorageIsReady } from "../../../lib/automation-readiness";
import { runFleetAutomation } from "../../../lib/server-automation";
import { getStorageHealth } from "../../../lib/storage-health";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const storage = await getStorageHealth();
  if (!automationStorageIsReady(storage)) {
    return Response.json({
      ok: false,
      error: "persistent_storage_required",
      storage,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = await runFleetAutomation(new URL(request.url).origin);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "automation_failed";
    console.error("[trackfleet:automation] tick failed", { message });
    return Response.json({ ok: false, error: "automation_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
