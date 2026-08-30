import { getCompanyAutomationSettings } from "trackfleet-auth-session-store";
import { observeArrivalCompletion } from "trackfleet-delivery-completion";
import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { companyIdForAccount } from "./company-id";
import { clampCtmRelayGraceMinutes, clampUnloadGraceMinutes, parseUnloadGraceMinutes } from "./delivery-arrival";
import { runFleetBusinessTick } from "./fleet-business-tick";
import { rotatedVehicleBatch } from "./fleet-tick-rotation";
import { parseAutomationStartAt } from "./notification-policy";
import { getSendatrackSnapshot } from "./sendatrack";
import { applyVehicleAliases } from "./vehicle-alias-apply";

export type AutomationRunResult = {
  connected: boolean;
  vehicles: number;
  transitions: number;
  newEvents: number;
  delayEvents: number;
  arrivalSiteEvents: number;
  automaticCompletions: number;
  etaObservations: number;
  fleetPositions: number;
};

// Notification sends and telemetry pruning run in their own separate
// scheduled tick -- see notification-maintenance-tick.ts -- so they never
// compete with fleet sync for the same subrequest budget.
export async function runFleetAutomation(): Promise<AutomationRunResult> {
  const accountID = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim();
  if (!accountID) throw new Error("sendatrack_server_credentials_missing");

  const snapshot = await getSendatrackSnapshot();
  // The specific reason travels in the message itself (rather than being
  // dropped and re-fetched by the caller) -- see the tick route's
  // failureCodeFor, which used to re-call getSendatrackSnapshot() from
  // scratch just to recover this same value, roughly doubling a failing
  // tick's worst-case wall-clock time during an outage (each snapshot call
  // has its own ~25s worst-case retry budget). That extra latency, repeated
  // every 5 minutes for the outage's duration, was a plausible cause of a
  // heartbeat gap observed live: lastAttemptAt kept updating every tick
  // while lastFailureAt froze for 3+ hours during a real SENDATRACK outage,
  // consistent with the isolate being killed after the first snapshot call
  // failed but before the second one (and recordAutomationFailure) ran.
  if (!snapshot.connected) throw new Error(`sendatrack_snapshot_disconnected:${snapshot.error ?? "unknown"}`);

  const companyId = await companyIdForAccount(accountID);
  const automationSettings = await getCompanyAutomationSettings(companyId);
  const unloadGraceMinutes = typeof automationSettings?.unloadGraceMinutes === "number"
    ? clampUnloadGraceMinutes(automationSettings.unloadGraceMinutes)
    : parseUnloadGraceMinutes(runtimeEnv.TRACKFLEET_UNLOAD_GRACE_MINUTES);
  const ctmRelayGraceMinutes = typeof automationSettings?.ctmRelayGraceMinutes === "number"
    ? clampCtmRelayGraceMinutes(automationSettings.ctmRelayGraceMinutes)
    : undefined;
  const ctmRelayAutoCompletionEnabled = automationSettings?.ctmRelayAutoCompletionEnabled ?? undefined;
  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);
  // Below ~10 vehicles this is a no-op (the whole fleet processes every
  // tick, same as always). Above it, only a rotating subset gets fully
  // processed each tick -- see fleet-tick-rotation.ts -- so per-tick
  // subrequest cost stays bounded as the fleet grows, at the cost of full
  // freshness across the whole fleet taking a couple of ticks instead of
  // one. This only applies to the scheduled tick; a dispatcher's own
  // dashboard load (/api/deliveries) always processes the full live fleet.
  const rotatedSnapshot = { ...snapshot, vehicles: rotatedVehicleBatch(snapshot.vehicles) };
  const aliasedSnapshot = await applyVehicleAliases(rotatedSnapshot, companyId);
  const business = await runFleetBusinessTick({
    snapshot: aliasedSnapshot,
    companyId,
    unloadGraceMinutes,
    store,
    observeArrivalCompletion,
    automationStartAt,
    ctmRelayGraceMinutes,
    ctmRelayAutoCompletionEnabled,
  });

  console.info("[trackfleet:automation] tick", {
    vehicles: business.vehicles,
    transitions: business.transitions,
    newEvents: business.newEvents,
    delayEvents: business.delayEvents,
    arrivalSiteEvents: business.arrivalSiteEvents,
    automaticCompletions: business.automaticCompletions,
    etaObservations: business.etaObservations,
    fleetPositions: business.fleetPositions,
  });

  return {
    connected: true,
    vehicles: business.vehicles,
    transitions: business.transitions,
    newEvents: business.newEvents,
    delayEvents: business.delayEvents,
    arrivalSiteEvents: business.arrivalSiteEvents,
    automaticCompletions: business.automaticCompletions,
    etaObservations: business.etaObservations,
    fleetPositions: business.fleetPositions,
  };
}
