import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot, type SendatrackCredentials } from "./sendatrack";

export type CompanySession = {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentials: SendatrackCredentials;
};

const cookieName = "__Host-trackfleet_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;

type SessionPayload = {
  accountID: string;
  user: string;
  password: string;
  expiresAt: number;
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(size = 32) {
  return toBase64(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sha256(value: string) {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey() {
  const encoded = runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim();
  let raw: Uint8Array;
  if (encoded) {
    raw = fromBase64(encoded);
    if (raw.byteLength !== 32) throw new Error("server_not_configured");
  } else {
    const fallbackSecret = runtimeEnv.SENDATRACK_PASSWORD;
    if (!fallbackSecret) throw new Error("server_not_configured");
    raw = await sha256Bytes(`trackfleet-session:${fallbackSecret}`);
  }
  const keyMaterial = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptPayload(payload: SessionPayload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), plaintext);
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

async function decryptPayload(value: string): Promise<SessionPayload> {
  const [ivValue, ciphertextValue] = value.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("invalid_session");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await encryptionKey(),
    fromBase64(ciphertextValue),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) return value.join("=");
  }
  return "";
}

export async function ensureAuthTables() {
  // Compatibility no-op: sessions are encrypted, stateless cookies on both runtimes.
}

export async function createCompanySession(credentials: SendatrackCredentials) {
  const normalized = {
    accountID: credentials.accountID.trim(),
    user: credentials.user.trim(),
    password: credentials.password,
  };
  if (!normalized.accountID || !normalized.user || !normalized.password) throw new Error("missing_credentials");

  const snapshot = await getSendatrackSnapshot(normalized);
  if (!snapshot.connected) throw new Error(snapshot.error === "authentication_failed" ? "authentication_failed" : "sendatrack_unavailable");

  const expiresAt = Date.now() + sessionDurationSeconds * 1000;
  const encrypted = await encryptPayload({ ...normalized, expiresAt });

  return {
    cookie: `${cookieName}=${encrypted}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    company: { account: normalized.accountID, user: normalized.user },
    vehicles: snapshot.vehicles,
  };
}

export async function getCompanySession(request: Request): Promise<CompanySession | null> {
  const token = cookieValue(request);
  if (!token) return null;
  try {
    const payload = await decryptPayload(token);
    if (payload.expiresAt <= Date.now()) return null;
    return {
      companyId: await sha256(`sendatrack-account:${payload.accountID.toLowerCase()}`),
      accountLabel: payload.accountID,
      userLabel: payload.user,
      credentials: {
        accountID: payload.accountID,
        user: payload.user,
        password: payload.password,
      },
    };
  } catch {
    return null;
  }
}

export async function deleteCompanySession(_request: Request) {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function createTrackingToken() {
  return randomToken(18);
}
