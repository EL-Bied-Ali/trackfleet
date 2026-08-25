import { runtimeEnv } from "trackfleet-runtime-env";

// Deliberately independent of company-auth.ts's own session/signing
// machinery, even though the underlying secret material overlaps
// (TRACKFLEET_ENCRYPTION_KEY) -- "can see every company's data" is a
// fundamentally different privilege tier than "one company's dispatcher
// session", so it gets its own cookie, its own token shape, and its own
// domain-separated signing key rather than being layered onto the existing
// CompanySession type.
const cookieName = "__Host-trackfleet_admin_session";
const sessionDurationSeconds = 7 * 24 * 60 * 60;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function adminSigningKey() {
  const secret = runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim() || runtimeEnv.SENDATRACK_PASSWORD;
  if (!secret) throw new Error("server_not_configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`trackfleet-admin-session:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signPayload(encodedPayload: string) {
  const signature = await crypto.subtle.sign("HMAC", await adminSigningKey(), new TextEncoder().encode(encodedPayload));
  return toBase64(new Uint8Array(signature));
}

export function isAllowedAdminEmail(email: string) {
  const allowlist = (runtimeEnv.ADMIN_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

type AdminTokenPayload = { version: 1; email: string; expiresAt: number };

export async function createAdminSessionCookie(email: string) {
  const payload: AdminTokenPayload = { version: 1, email, expiresAt: Date.now() + sessionDurationSeconds * 1000 };
  const encoded = toBase64(new TextEncoder().encode(JSON.stringify(payload)));
  const token = `${encoded}.${await signPayload(encoded)}`;
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`;
}

export function clearAdminSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) return value.join("=");
  }
  return "";
}

// Re-checks the allowlist fresh on every call, not just at token issuance --
// removing an email from ADMIN_EMAILS must revoke access immediately, even
// for an already-issued, correctly-signed token that hasn't expired yet.
export async function getAdminEmail(request: Request): Promise<string | null> {
  const token = cookieValue(request);
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  try {
    const expected = await signPayload(encoded);
    if (!bytesEqual(fromBase64(signature), fromBase64(expected))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64(encoded))) as Partial<AdminTokenPayload>;
    if (
      payload.version !== 1
      || typeof payload.email !== "string"
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt < Date.now()
      || !isAllowedAdminEmail(payload.email)
    ) return null;
    return payload.email;
  } catch {
    return null;
  }
}
