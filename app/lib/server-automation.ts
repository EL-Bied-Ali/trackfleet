import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { pruneTelemetry } from "trackfleet-telemetry-retention";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { parseUnloadGraceMinutes } from "./delivery-arrival";
import { runFleetBusinessTick } from "./fleet-business-tick";
import { processPendingNotifications } from "./notification-runner";
import { parseAutomationStartAt } from "./notification-policy";
import { getSendatrackSnapshot } from "./sendatrack";
import { telemetryRetentionPolicy } from "./telemetry-retention";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  delayEvents: number;
  arrivalSiteEvents: number;
  automaticCompletions: number;
  notificationsSent: number;
  notificationFailures: number;
  etaObservations: number;
  fleetPositions: number;
  telemetryPruned: number;
};

export async function runFleetAutomation(origin: string): Promise<AutomationRunResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");

  const snapshot = await getSendatrackSnapshot();
  if (!snapshot.connected) throw new Error("sendatrack_snapshot_disconnected");

  const companyId = await companyIdForAccount(accountID);
  const unloadGraceMinutes = parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);
  const business = await runFleetBusinessTick({
    snapshot,
    companyId,
    unloadGraceMinutes,
    store,
    observeArrivalCompletion,
    automationStartAt,
  });

  // The scheduled tick isn't blocking a dispatcher's page load, so it can
  // afford to drain a larger slice of the backlog than an interactive
  // request (see processPendingNotifications' default cap).
  const notifications = await processPendingNotifications(companyId, origin, 20);
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

  console.info("[trackfleet:automation] tick", {
    vehicles: business.vehicles,
    transitions: business.transitions,
    newEvents: business.newEvents,
    delayEvents: business.delayEvents,
    arrivalSiteEvents: business.arrivalSiteEvents,
    automaticCompletions: business.automaticCompletions,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations: business.etaObservations,
    fleetPositions: business.fleetPositions,
    telemetryPruned,
  });

  return {
    connected: true,
    vehicles: business.vehicles,
    transitions: business.transitions,
    newEvents: business.newEvents,
    delayEvents: business.delayEvents,
    arrivalSiteEvents: business.arrivalSiteEvents,
    automaticCompletions: business.automaticCompletions,
    notificationsSent: notifications.sent,
    notificationFailures: notifications.failed,
    etaObservations: business.etaObservations,
    fleetPositions: business.fleetPositions,
    telemetryPruned,
  };
}
