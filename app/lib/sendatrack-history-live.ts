import { getSendatrackLegacyHistoryIdentities, type SendatrackLegacyHistoryIdentity } from "./sendatrack";
import { buildSendatrackHistoryUrl, normalizeSendatrackHistory } from "./sendatrack-history";

export type SendatrackHistoryProbeAttempt = {
  accountSource: SendatrackLegacyHistoryIdentity["accountSource"];
  endpointSource: "events7" | "eventsApp";
  status: number;
  pointCount: number;
  providerError: string | null;
  error: string | null;
};

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
  usedPassword?: boolean;
  attempts?: SendatrackHistoryProbeAttempt[];
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

async function fetchHistoryUrl(url: string, identity: SendatrackLegacyHistoryIdentity, endpointSource: "events7" | "eventsApp") {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    const text = await response.text();
    const common = {
      accountSource: identity.accountSource,
      usedUserId: Boolean(identity.userId),
      usedPassword: Boolean(identity.password),
      endpointSource,
    };
    if (!response.ok) {
      return { ...emptyResult(`history_http_${response.status}`), status: response.status, contentType, ...common };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ...emptyResult("history_invalid_json"), status: response.status, contentType, ...common };
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
        ...common,
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
      ...common,
    } satisfies SendatrackHistoryProbeResult;
  } catch (error) {
    return {
      ...emptyResult(error instanceof Error ? error.name : "history_fetch_failed"),
      accountSource: identity.accountSource,
      usedUserId: Boolean(identity.userId),
      usedPassword: Boolean(identity.password),
      endpointSource,
    };
  }
}

function asAttempt(result: SendatrackHistoryProbeResult): SendatrackHistoryProbeAttempt {
  return {
    accountSource: result.accountSource ?? "configured",
    endpointSource: result.endpointSource ?? "events7",
    status: result.status,
    pointCount: result.pointCount,
    providerError: result.providerError ?? null,
    error: result.error ?? null,
  };
}

export async function probeSendatrackHistory(hours = 24): Promise<SendatrackHistoryProbeResult> {
  const identities = await getSendatrackLegacyHistoryIdentities();
  if (identities.length === 0) return emptyResult("missing_legacy_identity");

  const to = Date.now();
  const from = to - Math.max(1, Math.min(hours, 168)) * 60 * 60 * 1000;
  const attempts: SendatrackHistoryProbeAttempt[] = [];

  for (const identity of identities.slice(0, 3)) {
    const events7Url = buildSendatrackHistoryUrl({
      accountId: identity.accountId,
      userId: identity.userId,
      password: identity.password,
      deviceId: identity.deviceId,
      from,
      to,
    });
    let result = await fetchHistoryUrl(events7Url, identity, "events7");
    attempts.push(asAttempt(result));
    if (result.ok) return { ...result, attempts };

    if (/\(account\)/i.test(result.providerError ?? "") || /authorization/i.test(result.providerError ?? "")) {
      const eventsAppUrl = events7Url.replace("/events7/", "/eventsApp/");
      result = await fetchHistoryUrl(eventsAppUrl, identity, "eventsApp");
      attempts.push(asAttempt(result));
      if (result.ok) return { ...result, attempts };
    }
  }

  const last = attempts.at(-1);
  return {
    ...emptyResult("history_known_candidates_rejected"),
    status: last?.status ?? 0,
    accountSource: last?.accountSource,
    endpointSource: last?.endpointSource,
    usedUserId: identities.some((identity) => Boolean(identity.userId)),
    usedPassword: identities.some((identity) => Boolean(identity.password)),
    attempts,
    providerError: last?.providerError ?? undefined,
  };
}
