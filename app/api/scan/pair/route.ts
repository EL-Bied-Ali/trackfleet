import { getCompanySession } from "../../../lib/company-auth";
import { createScannerPairing, listScannerDevices, revokeScannerDevice } from "../../../lib/scanner-pairing";
import type { DeliveryScanCheckpoint } from "../../../lib/delivery-store.types";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

const validCheckpoints: DeliveryScanCheckpoint[] = ["loaded", "arrived", "delivered"];

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  try {
    const devices = await listScannerDevices(session);
    return json({ devices });
  } catch {
    return json({ error: "scanner_pairing_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deviceLabel = String(payload.deviceLabel ?? "").trim();
  if (!deviceLabel) return json({ error: "device_label_required" }, 400);
  const rawCheckpoint = payload.checkpoint;
  if (rawCheckpoint != null && !validCheckpoints.includes(rawCheckpoint as DeliveryScanCheckpoint)) {
    return json({ error: "invalid_checkpoint" }, 400);
  }
  const checkpoint = (rawCheckpoint as DeliveryScanCheckpoint | null | undefined) ?? null;
  try {
    const pairing = await createScannerPairing(session, deviceLabel, checkpoint);
    return json({ ...pairing, scope: session.siteId ?? "Compte central" });
  } catch {
    return json({ error: "scanner_pairing_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return json({ error: "authentication_required" }, 401);
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const deviceId = String(payload.deviceId ?? "").trim();
  if (!deviceId) return json({ error: "device_id_required" }, 400);
  try {
    const revoked = await revokeScannerDevice(session, deviceId);
    if (!revoked) return json({ error: "device_not_found" }, 404);
    return json({ ok: true });
  } catch {
    return json({ error: "scanner_pairing_unavailable" }, 503);
  }
}
