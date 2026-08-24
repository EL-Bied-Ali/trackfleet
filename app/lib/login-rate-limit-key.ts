import { runtimeEnv } from "trackfleet-runtime-env";

const encoder = new TextEncoder();

// cf-connecting-ip is set by Cloudflare's own edge and cannot be spoofed by
// the client -- Cloudflare overwrites any client-supplied header with that
// exact name before the Worker ever sees the request. x-forwarded-for is not
// safe to trust alone: a client can prepend an arbitrary value to that list,
// and this app has no reverse proxy in front of it that's guaranteed to
// normalize it. Falls back to x-forwarded-for/x-real-ip for the Vercel
// deployment target and local dev, where those are the best available
// signal, but on Cloudflare (the primary production target) skipping
// cf-connecting-ip here would let anyone bypass login rate limiting entirely
// by rotating a fake x-forwarded-for value per request.
export function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function loginRateLimitKey(request: Request) {
  const secret = runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim();
  if (!secret) return "missing-key";

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`trackfleet-login:${clientAddress(request)}`),
  );
  return base64Url(new Uint8Array(digest));
}
