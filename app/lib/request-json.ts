export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

async function readBodyWithLimit(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request_body_too_large").catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonObject(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES) {
  try {
    const text = await readBodyWithLimit(request, Math.max(1, Math.floor(maxBytes)));
    if (text === null || !text.trim()) return null;
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function invalidJsonResponse() {
  return Response.json({ error: "invalid_json" }, { status: 400, headers: { "cache-control": "no-store" } });
}
