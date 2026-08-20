import { getDispatcherSession } from "../../../lib/company-auth";
import {
  DELIVERY_HISTORY_DEFAULT_PAGE_SIZE,
  DELIVERY_HISTORY_MAX_PAGE_SIZE,
  listDeliveredHistory,
} from "../../../lib/delivery-history.postgres";

function parsedLimit(value: string | null) {
  if (!value) return DELIVERY_HISTORY_DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > DELIVERY_HISTORY_MAX_PAGE_SIZE) return null;
  return parsed;
}

function parsedCursor(url: URL) {
  const beforeCreatedAt = url.searchParams.get("beforeCreatedAt")?.trim() ?? "";
  const beforeId = url.searchParams.get("beforeId")?.trim() ?? "";
  if (!beforeCreatedAt && !beforeId) return null;
  if (!beforeCreatedAt || !beforeId || beforeId.length > 200) return false as const;
  const date = new Date(beforeCreatedAt);
  if (!Number.isFinite(date.getTime())) return false as const;
  return { beforeCreatedAt: date.toISOString(), beforeId };
}

export async function GET(request: Request) {
  const session = await getDispatcherSession(request);
  if (!session) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const limit = parsedLimit(url.searchParams.get("limit"));
  const cursor = parsedCursor(url);
  if (limit === null || cursor === false) {
    return Response.json(
      { error: "invalid_history_cursor" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const page = await listDeliveredHistory(session.companyId, { limit, cursor });
    return Response.json(page, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[trackfleet:delivery-history] history read failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return Response.json(
      { error: "history_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
