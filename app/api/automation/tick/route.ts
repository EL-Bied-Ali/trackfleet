import { runtimeEnv } from "trackfleet-runtime-env";
import {
  recordAutomationAttempt,
  recordAutomationFailure,
  recordAutomationSuccess,
  type AutomationFailureCode,
} from "trackfleet-automation-heartbeat";
import { automationStorageIsReady } from "../../../lib/automation-readiness";
import { runFleetAutomation } from "../../../lib/server-automation";
import { getStorageHealth } from "../../../lib/storage-health";

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function bestEffortHeartbeat(label: string, operation: () => Promise<void>) {
  try {
    await operation();
  } catch (error) {
    console.error("[trackfleet:automation] heartbeat persistence failed", {
      label,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

// The specific SENDATRACK failure reason travels inline in the thrown
// message (see server-automation.ts's runFleetAutomation) instead of being
// recovered here via a second getSendatrackSnapshot() call -- that used to
// roughly double a failing tick's worst-case wall-clock time during an
// outage, risking a hard platform kill before recordAutomationFailure below
// ever gets a chance to run.
function failureCodeFor(message: string): AutomationFailureCode {
  if (message === "sendatrack_server_credentials_missing") return "sendatrack_not_configured";
  if (!message.startsWith("sendatrack_snapshot_disconnected:")) return "automation_failed";

  const reason = message.slice("sendatrack_snapshot_disconnected:".length);
  if (reason === "authentication_failed") return "sendatrack_authentication_failed";
  if (reason === "unexpected_response") return "sendatrack_unexpected_response";
  if (reason === "not_configured") return "sendatrack_not_configured";
  if (reason === "service_unavailable") return "sendatrack_service_unavailable";
  return "sendatrack_disconnected";
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

  await bestEffortHeartbeat("attempt", recordAutomationAttempt);
  try {
    const result = await runFleetAutomation();
    await bestEffortHeartbeat("success", recordAutomationSuccess);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "automation_failed";
    const failureCode = failureCodeFor(message);
    await bestEffortHeartbeat("failure", () => recordAutomationFailure(failureCode));
    console.error("[trackfleet:automation] tick failed", { message, failureCode });
    return Response.json({ ok: false, error: "automation_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
