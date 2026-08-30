import { getCompanyAutomationSettings, updateCompanyAutomationSettings } from "trackfleet-auth-session-store";
import { getCompanySession, getDispatcherSession } from "../../../lib/company-auth";
import {
  MIN_UNLOAD_GRACE_MINUTES, MAX_UNLOAD_GRACE_MINUTES,
  MIN_CTM_RELAY_GRACE_MINUTES, MAX_CTM_RELAY_GRACE_MINUTES,
} from "../../../lib/delivery-arrival";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Read side is any authenticated session -- an agency dashboard doesn't
// currently show these settings, but there's no reason to restrict the read
// tighter than branding's, and it keeps this route consistent with every
// other company-wide setting in this app. Only editing is dispatcher-only.
export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const settings = await getCompanyAutomationSettings(session.companyId);
  return noStore({
    settings: settings ?? { unloadGraceMinutes: null, ctmRelayGraceMinutes: null, ctmRelayAutoCompletionEnabled: null },
  });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  // Same full-state-every-save contract as company/branding: null on any
  // field clears that override back to the deploy-wide default, there's no
  // separate "omitted means leave unchanged" case to support.
  let unloadGraceMinutes: number | null = null;
  if (payload.unloadGraceMinutes !== null && payload.unloadGraceMinutes !== undefined) {
    const parsed = Number(payload.unloadGraceMinutes);
    if (!Number.isFinite(parsed) || parsed < MIN_UNLOAD_GRACE_MINUTES || parsed > MAX_UNLOAD_GRACE_MINUTES) {
      return noStore({ error: "invalid_unload_grace_minutes" }, 400);
    }
    unloadGraceMinutes = Math.round(parsed);
  }

  let ctmRelayGraceMinutes: number | null = null;
  if (payload.ctmRelayGraceMinutes !== null && payload.ctmRelayGraceMinutes !== undefined) {
    const parsed = Number(payload.ctmRelayGraceMinutes);
    if (!Number.isFinite(parsed) || parsed < MIN_CTM_RELAY_GRACE_MINUTES || parsed > MAX_CTM_RELAY_GRACE_MINUTES) {
      return noStore({ error: "invalid_ctm_relay_grace_minutes" }, 400);
    }
    ctmRelayGraceMinutes = Math.round(parsed);
  }

  const ctmRelayAutoCompletionEnabled = payload.ctmRelayAutoCompletionEnabled === null || payload.ctmRelayAutoCompletionEnabled === undefined
    ? null
    : payload.ctmRelayAutoCompletionEnabled === true;

  await updateCompanyAutomationSettings(session.companyId, {
    unloadGraceMinutes,
    ctmRelayGraceMinutes,
    ctmRelayAutoCompletionEnabled,
  });

  return noStore({ ok: true });
}
