import { getSendatrackLegacyHistoryIdentity } from "./sendatrack";
import { buildSendatrackHistoryUrl, normalizeSendatrackHistory } from "./sendatrack-history";

export type SendatrackHistoryProbeResult = {
  ok: boolean;
  status: number;
  contentType: string;
  pointCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  payloadKeys: string[];
  accountSource?: "account_desc" | "account" | "configured";
  endpointSource?: "events7" | "eventsApp";
  usedUserId?: boolean;
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

async function fetchHistoryUrl(url: string, accountSource: SendatrackHistoryProbeResult["accountSource"], usedUserId: boolean, endpointSource: "events7" | "eventsApp") {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    const text = await response.text();
    if (!response.ok) {
      return { ...emptyResult(`history_http_${response.status}`), status: response.status, contentType, accountSource, usedUserId, endpointSource };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ...emptyResult("history_invalid_json"), status: response.status, contentType, accountSource, usedUserId, endpointSource };
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
        accountSource,
        usedUserId,
        endpointSource,
        providerError,
        error: "history_provider_error",
      } satisfies SendatrackHistoryProbeResult;
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
      accountSource,
      usedUserId,
      endpointSource,
    } satisfies SendatrackHistoryProbeResult;
  } catch (error) {
    return { ...emptyResult(error instanceof Error ? error.name : "history_fetch_failed"), accountSource, usedUserId, endpointSource };
  }
}

export async function probeSendatrackHistory(hours = 24): Promise<SendatrackHistoryProbeResult> {
  const identity = await getSendatrackLegacyHistoryIdentity();
  if (!identity?.accountId) return emptyResult("missing_legacy_account");
  if (!identity.deviceId) return emptyResult("missing_legacy_device");

  const to = Date.now();
  const from = to - Math.max(1, Math.min(hours, 168)) * 60 * 60 * 1000;
  const events7Url = buildSendatrackHistoryUrl({
    accountId: identity.accountId,
    userId: identity.userId,
    deviceId: identity.deviceId,
    from,
    to,
  });
  const usedUserId = Boolean(identity.userId);
  let result = await fetchHistoryUrl(events7Url, identity.accountSource, usedUserId, "events7");

  // The APK also embeds eventsApp/data.jsonx. Only try it after events7 itself
  // reports an account lookup failure, keeping discovery traffic bounded.
  if (!result.ok && /\(account\)/i.test(result.providerError ?? "")) {
    const eventsAppUrl = events7Url.replace("/events7/", "/eventsApp/");
    result = await fetchHistoryUrl(eventsAppUrl, identity.accountSource, usedUserId, "eventsApp");
  }
  return result;
}
