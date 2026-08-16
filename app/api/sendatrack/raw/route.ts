import { getCompanySession } from "../../../lib/company-auth";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findToken(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    const bearer = value.match(/Bearer\s+([^\s]+)/i)?.[1];
    if (bearer) return bearer;
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["token", "access_token", "accessToken", "jwt", "JWT"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 20) return candidate.replace(/^Bearer\s+/i, "");
  }
  for (const candidate of Object.values(record)) {
    const token = findToken(candidate, depth + 1);
    if (token) return token;
  }
  return null;
}

const apiBase = "http://backend2.sendatrack.com/sendatrack/public/api/";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });

  const loginResponse = await fetch(new URL("login", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      ...session.credentials,
      machin: "trackfleet-debug",
      remember: true,
      force: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!loginResponse.ok) return Response.json({ error: "authentication_failed" }, { status: 502 });

  const loginPayload = await loginResponse.json() as unknown;
  const token = findToken(loginPayload);
  if (!token) return Response.json({ error: "authentication_failed" }, { status: 502 });

  const fleetResponse = await fetch(new URL("list?", apiBase), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!fleetResponse.ok) return Response.json({ error: "sendatrack_unavailable", status: fleetResponse.status }, { status: 502 });

  const raw = await fleetResponse.json() as unknown;
  return Response.json(raw, {
    headers: {
      "cache-control": "no-store, private",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
