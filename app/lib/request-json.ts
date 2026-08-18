export async function readJsonObject(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function invalidJsonResponse() {
  return Response.json({ error: "invalid_json" }, { status: 400, headers: { "cache-control": "no-store" } });
}
