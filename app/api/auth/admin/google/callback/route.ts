import { createAdminSessionCookie, isAllowedAdminEmail } from "../../../../../lib/admin-auth";
import { exchangeGoogleCode, googleStateCookieName } from "../../../../../lib/google-oauth";

const clearStateCookie = `${googleStateCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function redirectToAdmin(request: Request, search: string) {
  const url = new URL("/admin", request.url);
  url.search = search;
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": clearStateCookie },
  });
}

export async function GET(request: Request) {
  // Same cross-site-by-design reasoning as the regular Google callback:
  // this request IS accounts.google.com's own redirect back to us, so no
  // requestIsSameOrigin check here -- the state cookie is the real CSRF
  // defense.
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === googleStateCookieName)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToAdmin(request, "?admin_error=1");
  }

  try {
    const identity = await exchangeGoogleCode(code, new URL("/api/auth/admin/google/callback", request.url).toString());
    if (!isAllowedAdminEmail(identity.email)) {
      console.error("[trackfleet:admin] Google sign-in from a non-admin email rejected", { email: identity.email });
      return redirectToAdmin(request, "?admin_error=not_allowed");
    }

    const sessionCookie = await createAdminSessionCookie(identity.email);
    const headers = new Headers();
    headers.append("set-cookie", clearStateCookie);
    headers.append("set-cookie", sessionCookie);
    headers.set("location", new URL("/admin", request.url).toString());
    return new Response(null, { status: 302, headers });
  } catch {
    return redirectToAdmin(request, "?admin_error=1");
  }
}
