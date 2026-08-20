import { siteStore } from "trackfleet-site-store";
import {
  createAgencyEnrollmentToken,
  createAgencySessionFromEnrollment,
  getDispatcherSession,
} from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();

  const enrollmentToken = String(payload.token ?? "").trim();
  if (enrollmentToken) {
    try {
      const result = await createAgencySessionFromEnrollment(enrollmentToken);
      return json({ authenticated: true, company: result.company }, 200, { "set-cookie": result.cookie });
    } catch {
      return json({ error: "invalid_or_expired_agency_link" }, 401);
    }
  }

  const session = await getDispatcherSession(request);
  if (!session) return json({ error: "dispatcher_authentication_required" }, 401);
  const siteId = String(payload.siteId ?? "").trim();
  const site = (await siteStore.listForCompany(session.companyId)).find((candidate) => candidate.id === siteId);
  if (!site) return json({ error: "site_not_found" }, 404);

  const token = await createAgencyEnrollmentToken(session, siteId);
  const url = new URL("/agency/enroll", request.url);
  url.hash = `token=${encodeURIComponent(token)}`;
  return json({ siteId, enrollmentUrl: url.toString(), expiresInMinutes: 30 });
}
