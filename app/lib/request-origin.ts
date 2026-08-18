export function requestIsSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function originRejectedResponse() {
  return Response.json({ error: "origin_not_allowed" }, { status: 403 });
}
