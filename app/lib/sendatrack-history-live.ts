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
  providerError?: string;
  error?: string;
};

function emptyResult(error: string): SendatrackHistoryProbeResult {
  return { ok: false, status: 0, contentType: "", pointCount: 0, firstTimestamp: null, lastTimestamp: null, payloadKeys: [], error };
}

function safeProviderError(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>).Error;
  if (typeof value === "string") return value.slice(0, 240);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export async function probeSendatrackHistory(hours = 24): Promise<SendatrackHistoryProbeResult> {
  const snapshot = await getSendatrackSnapshot();
  const vehicle = snapshot.vehicles[0];
  if (!snapshot.connected || !vehicle) return emptyResult(snapshot.error ?? "no_vehicle");

  // The legacy events7 endpoint uses OpenGTS identifiers returned by SENDATRACK's
  // fleet payload. They are not necessarily the same account/device identifiers
  // used by the newer backend2 login API.
  const accountId = vehicle.providerAccountId;
  const deviceId = vehicle.providerDeviceId;
  if (!accountId) return emptyResult("missing_legacy_account");
  if (!deviceId) return emptyResult("missing_legacy_device");

  const to = Date.now();
  const from = to - Math.max(1, Math.min(hours, 168)) * 60 * 60 * 1000;
  const url = buildSendatrackHistoryUrl({ accountId, deviceId, from, to });

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    const text = await response.text();
    if (!response.ok) {
      return { ...emptyResult(`history_http_${response.status}`), status: response.status, contentType };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ...emptyResult("history_invalid_json"), status: response.status, contentType };
    }

    const payloadKeys = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>).slice(0, 20)
      : [];
    const providerError = safeProviderError(payload);
    if (providerError) {
      return {
        ok: false,
        status: response.status,
        contentType,
        pointCount: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        payloadKeys,
        providerError,
        error: "history_provider_error",
      };
    }

    const points = normalizeSendatrackHistory(payload);
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
    return emptyResult(error instanceof Error ? error.name : "history_fetch_failed");
  }
}
