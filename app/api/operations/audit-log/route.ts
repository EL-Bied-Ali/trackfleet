import { getDispatcherSession } from "../../../lib/company-auth";
import { listCompanyAuditLog } from "../../../lib/company-audit-log";

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Dispatcher-only, same as the delete-delivery action this mostly exists
// to make accountable for -- an agency session never sees this, matching
// the delete route's own dispatcher-only gate.
export async function GET(request: Request) {
  const session = await getDispatcherSession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const beforeIdRaw = url.searchParams.get("beforeId");
  const beforeId = beforeIdRaw ? Number(beforeIdRaw) : null;
  if (beforeIdRaw && (!Number.isInteger(beforeId) || beforeId === null || beforeId <= 0)) {
    return noStore({ error: "invalid_cursor" }, 400);
  }

  try {
    const page = await listCompanyAuditLog(session.companyId, { beforeId });
    return noStore(page);
  } catch (error) {
    console.error("[trackfleet:company-audit-log] read failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return noStore({ error: "audit_log_unavailable" }, 503);
  }
}
