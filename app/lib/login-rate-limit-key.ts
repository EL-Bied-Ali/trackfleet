import { runtimeEnv } from "trackfleet-runtime-env";

const encoder = new TextEncoder();

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
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
