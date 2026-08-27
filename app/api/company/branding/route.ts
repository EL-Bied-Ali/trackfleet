import { getCompanyBranding, updateCompanyBranding } from "trackfleet-auth-session-store";
import { getCompanySession, getDispatcherSession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

const MAX_NAME_LENGTH = 80;
const MAX_LOGO_DATA_URL_LENGTH = 300_000;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/;

function noStore(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Read side is any authenticated session (agency dashboards show the same
// company branding as dispatchers, in the sidebar) -- only editing is
// dispatcher-only, matching every other company-wide setting in this app.
export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);
  const branding = await getCompanyBranding(session.companyId);
  return noStore({ branding: branding ?? { name: null, logoDataUrl: null, color: null } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getDispatcherSession(request);
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  // The settings form always submits its full current state in one save
  // (not a per-field patch), so every field below is a plain "this is the
  // new value" -- an empty string or null clears that field, there's no
  // separate "omitted means leave unchanged" case to support.
  const name = String(payload.name ?? "").trim();
  if (name.length > MAX_NAME_LENGTH) return noStore({ error: "name_too_long" }, 400);

  const color = String(payload.color ?? "").trim();
  if (color !== "" && !HEX_COLOR_PATTERN.test(color)) return noStore({ error: "invalid_color" }, 400);

  const logoDataUrl = String(payload.logoDataUrl ?? "").trim();
  if (logoDataUrl !== "") {
    if (logoDataUrl.length > MAX_LOGO_DATA_URL_LENGTH) return noStore({ error: "logo_too_large" }, 400);
    if (!LOGO_DATA_URL_PATTERN.test(logoDataUrl)) return noStore({ error: "invalid_logo_format" }, 400);
  }

  await updateCompanyBranding(session.companyId, {
    name: name || null,
    logoDataUrl: logoDataUrl || null,
    color: color || null,
  });

  return noStore({ ok: true });
}
