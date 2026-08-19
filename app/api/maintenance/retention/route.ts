import { recordRuntimeAttempt, recordRuntimeFailure, recordRuntimeSuccess } from "trackfleet-automation-heartbeat";
import { pruneAllTelemetry } from "trackfleet-telemetry-retention";
import { runtimeEnv } from "trackfleet-runtime-env";
import { telemetryRetentionPolicy } from "../../../lib/telemetry-retention";
import { getStorageHealth } from "../../../lib/storage-health";

const retentionJob = "telemetry_retention" as const;

function authorized(request: Request) {
  const secret = runtimeEnv.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function heartbeat(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error("[trackfleet:retention] heartbeat write failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  await heartbeat(() => recordRuntimeAttempt(retentionJob));

  const storage = await getStorageHealth();
  if (!storage.persistent || !storage.connected) {
    await heartbeat(() => recordRuntimeFailure(retentionJob));
    return Response.json({ ok: false, error: "persistent_storage_required", storage }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const retention = telemetryRetentionPolicy(runtimeEnv.TRACKFLEET_TELEMETRY_RETENTION_DAYS);
  if (!retention.valid || retention.days === null) {
    await heartbeat(() => recordRuntimeFailure(retentionJob));
    return Response.json({ ok: false, error: "telemetry_retention_invalid", retention }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const result = await pruneAllTelemetry(retention.days);
    await heartbeat(() => recordRuntimeSuccess(retentionJob));
    return Response.json({ ok: true, retention, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await heartbeat(() => recordRuntimeFailure(retentionJob));
    console.error("[trackfleet:retention] daily maintenance failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return Response.json({ ok: false, error: "retention_failed" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
