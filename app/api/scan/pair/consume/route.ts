import { consumeScannerPairing } from "../../../../lib/scanner-pairing";
import { invalidJsonResponse, readJsonObject } from "../../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../../lib/request-origin";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const code = String(payload.code ?? "").trim();
  const result = await consumeScannerPairing(code);
  if (!result) return Response.json({ error: "pairing_invalid_or_expired" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json({ ok: true, company: { account: result.session.accountLabel, role: result.session.role, siteId: result.session.siteId } }, {
    headers: { "set-cookie": result.cookie, "cache-control": "no-store" },
  });
}

