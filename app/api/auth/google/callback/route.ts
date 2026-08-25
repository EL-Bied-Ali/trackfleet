import {
  createCompanySession,
  createGooglePendingLinkToken,
  decryptCredentials,
} from "../../../../lib/company-auth";
import { getGoogleLinkedCompany } from "../../../../lib/google-link-store";
import { exchangeGoogleCode, googleStateCookieName } from "../../../../lib/google-oauth";

const clearStateCookie = `${googleStateCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function redirectHome(request: Request, search: string) {
  const url = new URL("/", request.url);
  url.search = search;
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": clearStateCookie },
  });
}

export async function GET(request: Request) {
  // This request IS the redirect from accounts.google.com -- it is
  // legitimately cross-site by design, so no requestIsSameOrigin check here.
  // The state cookie below is the actual CSRF defense for this endpoint.
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === googleStateCookieName)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectHome(request, "?google_error=1");
  }

  try {
    const identity = await exchangeGoogleCode(code, new URL("/api/auth/google/callback", request.url).toString());
    const linked = await getGoogleLinkedCompany(identity.sub);

    if (linked) {
      const credentials = await decryptCredentials(linked.credentialsCiphertext);
      const result = await createCompanySession(credentials);
      const headers = new Headers();
      headers.append("set-cookie", clearStateCookie);
      headers.append("set-cookie", result.cookie);
      const home = new URL("/", request.url);
      headers.set("location", home.toString());
      return new Response(null, { status: 302, headers });
    }

    const pendingToken = await createGooglePendingLinkToken(identity);
    const home = new URL("/", request.url);
    home.searchParams.set("google_link", pendingToken);
    home.searchParams.set("google_email", identity.email);
    return new Response(null, {
      status: 302,
      headers: { location: home.toString(), "set-cookie": clearStateCookie },
    });
  } catch {
    return redirectHome(request, "?google_error=1");
  }
}
