import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { pruneTelemetry } from "trackfleet-telemetry-retention";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { parseUnloadGraceMinutes } from "./delivery-arrival";
import { runFleetBusinessTick } from "./fleet-business-tick";
import { rotatedVehicleBatch } from "./fleet-tick-rotation";
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
  // Below ~10 vehicles this is a no-op (the whole fleet processes every
  // tick, same as always). Above it, only a rotating subset gets fully
  // processed each tick -- see fleet-tick-rotation.ts -- so per-tick
  // subrequest cost stays bounded as the fleet grows, at the cost of full
  // freshness across the whole fleet taking a couple of ticks instead of
  // one. This only applies to the scheduled tick; a dispatcher's own
  // dashboard load (/api/deliveries) always processes the full live fleet.
  const rotatedSnapshot = { ...snapshot, vehicles: rotatedVehicleBatch(snapshot.vehicles) };
  const business = await runFleetBusinessTick({
    snapshot: rotatedSnapshot,
    companyId,
    unloadGraceMinutes,
    store,
    observeArrivalCompletion,
    automationStartAt,
  });

  // Kept conservative even though this tick isn't blocking a page load: the
  // scheduled tick already spends its own subrequest budget on fleet sync,
  // ETA/business-tick logic and telemetry pruning above, all higher priority
  // than notification retries. Observed in production: with the WhatsApp
  // token invalid, a cap of 20 guaranteed-to-fail sends on top of that other
  // work reliably blew Cloudflare's per-invocation subrequest limit on every
  // single tick, which in turn kept tripping the D1 read-only failover
  // safety net app-wide. A smaller cap still makes steady progress on the
  // backlog (each failed item now waits out its own retry window before
  // being attempted again -- see notification-claim-state.ts) without
  // starving the rest of the tick.
  const notifications = await processPendingNotifications(companyId, origin, 5);
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
