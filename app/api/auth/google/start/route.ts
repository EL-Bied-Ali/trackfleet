import { buildGoogleAuthorizeUrl, googleSignInConfigured, googleStateCookieName } from "../../../../lib/google-oauth";
import { requestIsSameOrigin } from "../../../../lib/request-origin";

const stateDurationSeconds = 600;

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function GET(request: Request) {
  if (!requestIsSameOrigin(request)) return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  if (!googleSignInConfigured()) return Response.json({ error: "google_not_configured" }, { status: 503 });

  const state = randomState();
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();

  return new Response(null, {
    status: 302,
    headers: {
      location: buildGoogleAuthorizeUrl(redirectUri, state),
      // Not the app's own session cookie, so a distinct name -- this only
      // has to survive the round trip to Google and back, hence the short
      // max-age (matches the pending-link token's own expiry window).
      "set-cookie": `${googleStateCookieName}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${stateDurationSeconds}`,
    },
  });
}
