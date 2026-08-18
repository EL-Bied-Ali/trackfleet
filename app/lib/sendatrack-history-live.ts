import { getSendatrackLegacyHistoryIdentities, type SendatrackLegacyHistoryIdentity } from "./sendatrack";
import { buildSendatrackHistoryUrl, normalizeSendatrackHistory, type SendatrackHistoryEndpoint } from "./sendatrack-history";

export type SendatrackHistoryProbeAttempt = {
  accountSource: SendatrackLegacyHistoryIdentity["accountSource"];
  endpointSource: SendatrackHistoryEndpoint;
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
  endpointSource?: SendatrackHistoryEndpoint;
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
  const record = payload as Record<string, unknown>;
  const raw = [record.Error, record.error, record.message].find((value) => typeof value === "string");
  if (typeof raw !== "string" || !raw.trim()) return "";
  const normalized = raw.toLowerCase();
  if (normalized.includes("too many") || normalized.includes("rate")) return "rate_limited";
  if (normalized.includes("authorization") || normalized.includes("authorisation") || normalized.includes("password")) return "invalid_authorization";
  if (normalized.includes("account")) return "account_error";
  if (normalized.includes("device")) return "device_error";
  return "provider_error";
}

async function fetchHistoryUrl(url: string, identity: SendatrackLegacyHistoryIdentity, endpointSource: SendatrackHistoryEndpoint) {
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
    endpointSource: result.endpointSource ?? "eventsApp2",
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
  const endpoints: SendatrackHistoryEndpoint[] = ["eventsApp2", "events7", "eventsApp"];

  // Bound discovery to values obtained from the already-authenticated account.
  // Never log URLs: legacy URLs contain p=<password> in their query string.
  for (const identity of identities.slice(0, 3)) {
    for (const endpoint of endpoints) {
      const url = buildSendatrackHistoryUrl({
        accountId: identity.accountId,
        userId: identity.userId,
        password: identity.password,
        deviceId: identity.deviceId,
        from,
        to,
        endpoint,
      });
      const result = await fetchHistoryUrl(url, identity, endpoint);
      attempts.push(asAttempt(result));
      if (result.ok) return { ...result, attempts };

      // Respect provider throttling instead of multiplying attempts.
      if (result.status === 429 || result.providerError === "rate_limited") {
        return {
          ...emptyResult("history_rate_limited"),
          status: result.status,
          accountSource: result.accountSource,
          endpointSource: result.endpointSource,
          usedUserId: result.usedUserId,
          usedPassword: result.usedPassword,
          attempts,
          providerError: result.providerError,
        };
      }
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
