import { buildGoogleAuthorizeUrl, googleSignInConfigured, googleStateCookieName } from "../../../../../lib/google-oauth";
import { requestIsSameOrigin } from "../../../../../lib/request-origin";

const stateDurationSeconds = 600;

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Shares the state-cookie mechanism (and its cookie name) with the regular
// company Google sign-in start route -- that's just CSRF nonce plumbing, not
// identity-bearing, so reusing it is safe. The two flows diverge entirely at
// the callback: this one checks an admin allowlist and never touches
// SENDATRACK credentials or company linking.
export async function GET(request: Request) {
  if (!requestIsSameOrigin(request)) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  if (!googleSignInConfigured()) return Response.json({ error: "google_not_configured" }, { status: 503 });

  const state = randomState();
  const redirectUri = new URL("/api/auth/admin/google/callback", request.url).toString();

  return new Response(null, {
    status: 302,
    headers: {
      location: buildGoogleAuthorizeUrl(redirectUri, state),
      "set-cookie": `${googleStateCookieName}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${stateDurationSeconds}`,
    },
  });
}
