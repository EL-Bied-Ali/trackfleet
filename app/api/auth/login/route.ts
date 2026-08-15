import { createCompanySession } from "../../../lib/company-auth";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const result = await createCompanySession({
      accountID: String(payload.accountID ?? ""),
      user: String(payload.user ?? ""),
      password: String(payload.password ?? ""),
    });
    return Response.json({ company: result.company, vehicleCount: result.vehicles.length }, {
      headers: { "set-cookie": result.cookie, "cache-control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "login_failed";
    const status = code === "missing_credentials" ? 400 : code === "authentication_failed" ? 401 : 503;
    return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
  }
}
