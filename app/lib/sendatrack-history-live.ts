import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot } from "./sendatrack";
import { buildSendatrackHistoryUrl, normalizeSendatrackHistory } from "./sendatrack-history";

export type SendatrackHistoryProbeResult = {
  ok: boolean;
  status: number;
  contentType: string;
  pointCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  payloadKeys: string[];
  error?: string;
};

export async function probeSendatrackHistory(hours = 24): Promise<SendatrackHistoryProbeResult> {
  const accountId = runtimeEnv.SENDATRACK_ACCOUNT_ID?.trim() ?? "";
  if (!accountId) return { ok: false, status: 0, contentType: "", pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error: "not_configured" };

  const snapshot = await getSendatrackSnapshot();
  const vehicle = snapshot.vehicles[0];
  if (!snapshot.connected || !vehicle) {
    return { ok: false, status: 0, contentType: "", pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error: snapshot.error ?? "no_vehicle" };
  }

  const to = Date.now();
  const from = to - Math.max(1, Math.min(hours, 168)) * 60 * 60 * 1000;
  const url = buildSendatrackHistoryUrl({ accountId, deviceId: vehicle.id, from, to });

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, contentType, pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error: `history_http_${response.status}` };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, contentType, pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error: "history_invalid_json" };
    }

    const points = normalizeSendatrackHistory(payload);
    const payloadKeys = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>).slice(0, 20)
      : [];
    return {
      ok: true,
      status: response.status,
      contentType,
      pointCount: points.length,
      firstTimestamp: points[0]?.timestamp ?? null,
      lastTimestamp: points.at(-1)?.timestamp ?? null,
      payloadKeys,
    };
  } catch (error) {
    return { ok: false, status: 0, contentType: "", pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error: error instanceof Error ? error.name : "history_fetch_failed" };
  }
}
