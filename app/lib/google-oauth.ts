import { runtimeEnv } from "trackfleet-runtime-env";

const googleAuthorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
// Google's tokeninfo endpoint validates the id_token's signature and expiry
// server-side and returns the decoded claims -- an extra network round trip
// versus verifying the JWT signature ourselves, but it avoids hand-rolling
// JWKS fetching/kid matching/RS256 verification for a login path that isn't
// latency-sensitive. Google documents this as a supported verification method.
const googleTokenInfoEndpoint = "https://oauth2.googleapis.com/tokeninfo";
const requestTimeoutMs = 10_000;

export type GoogleIdentity = { sub: string; email: string };

// Its own cookie name (distinct from the app's session cookie) so the OAuth
// state round trip to Google and back can't collide with or clobber an
// existing session cookie.
export const googleStateCookieName = "__Host-trackfleet_google_state";

function googleClientCredentials() {
  const clientId = runtimeEnv.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = runtimeEnv.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleSignInConfigured() {
  return googleClientCredentials() !== null;
}

export function buildGoogleAuthorizeUrl(redirectUri: string, state: string) {
  const credentials = googleClientCredentials();
  if (!credentials) throw new Error("google_not_configured");
  const url = new URL(googleAuthorizeEndpoint);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  // Always show the account chooser -- a dispatcher and an agency user on
  // the same shared computer must never silently inherit each other's last
  // Google session.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// Exchanges the authorization code for an id_token, then verifies it via
// Google's tokeninfo endpoint and checks it was actually issued for this
// app's client_id -- tokeninfo confirms the token is a genuine, unexpired
// Google token, but doesn't know which client_id we expect, so the audience
// check here is still required to stop a token meant for a different app
// from being accepted.
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleIdentity> {
  const credentials = googleClientCredentials();
  if (!credentials) throw new Error("google_not_configured");

  const tokenResponse = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!tokenResponse.ok) throw new Error("google_token_exchange_failed");
  const tokenBody = await tokenResponse.json() as { id_token?: string };
  if (!tokenBody.id_token) throw new Error("google_token_exchange_failed");

  const verifyResponse = await fetch(`${googleTokenInfoEndpoint}?id_token=${encodeURIComponent(tokenBody.id_token)}`, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!verifyResponse.ok) throw new Error("google_token_invalid");
  const claims = await verifyResponse.json() as {
    aud?: string;
    iss?: string;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
  };

  const issuerIsGoogle = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (
    !issuerIsGoogle
    || claims.aud !== credentials.clientId
    || !claims.sub
    || !claims.email
    || !emailVerified
  ) {
    throw new Error("google_token_invalid");
  }

  return { sub: claims.sub, email: claims.email };
}
