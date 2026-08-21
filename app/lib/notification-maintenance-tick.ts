import { pruneTelemetry } from "trackfleet-telemetry-retention";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { processPendingNotifications } from "./notification-runner";
import { telemetryRetentionPolicy } from "./telemetry-retention";

export type NotificationMaintenanceResult = {
  notificationsSent: number;
  notificationFailures: number;
  telemetryPruned: number;
};

// Notification sends and telemetry pruning used to run inside the same
// invocation as fleet sync (server-automation.ts), competing for the same
// subrequest budget. Split into their own scheduled tick (see
// notificationMaintenanceCron in wrangler.jsonc, offset from the fleet-sync
// cron so the two never run at the same moment either) so fleet sync -- the
// higher-priority, live-tracking part -- always gets to finish and record
// its own success cleanly. Reproduced live via wrangler tail: a tick that
// finished fleet sync fine still failed to record success because sending
// notifications and pruning telemetry afterward, in the same invocation,
// pushed it over Cloudflare's per-invocation subrequest limit.
export async function runNotificationMaintenanceTick(origin: string): Promise<NotificationMaintenanceResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");
  const companyId = await companyIdForAccount(accountID);

  // Still conservative even though this no longer competes with fleet sync:
  // with WHATSAPP_ACCESS_TOKEN currently invalid, every attempted send fails,
  // and each attempt still costs several subrequests of its own.
  const notifications = await processPendingNotifications(companyId, origin, 8);

  let telemetryPruned = 0;
  const retention = telemetryRetentionPolicy(runtimeEnv.TRACKFLEET_TELEMETRY_RETENTION_DAYS);
  if (retention.valid && retention.days !== null) {
    try {
      const pruned = await pruneTelemetry(companyId, retention.days);
      telemetryPruned = pruned.fleetPositions + pruned.tripPositions + pruned.etaObservations;
    } catch (error) {
      console.error("[trackfleet:automation] telemetry retention maintenance failed", {
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  console.info("[trackfleet:automation] notification maintenance tick", {
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    telemetryPruned,
  });

  return {
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    telemetryPruned,
  };
}
