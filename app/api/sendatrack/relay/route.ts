import { runtimeEnv } from "trackfleet-runtime-env";
import { setRelayUrl } from "../../../lib/sendatrack";

// Called by the SENDATRACK relay (relay/run.mjs) on startup and whenever its
// tunnel reconnects, to register the current URL the Worker should use to
// reach it. Authenticated with the same shared secret the relay uses to
// authenticate inbound proxy calls -- see relay/README.md.
export async function POST(request: Request) {
  const secret = runtimeEnv.SENDATRACK_RELAY_SECRET?.trim();
  if (!secret) return Response.json({ error: "relay_not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || !/^https:\/\//.test(url)) {
    return Response.json({ error: "invalid_url" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    await setRelayUrl(url);
  } catch {
    return Response.json({ error: "relay_storage_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
