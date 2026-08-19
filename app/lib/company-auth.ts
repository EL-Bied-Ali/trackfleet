import {
  createServerSession,
  deleteServerSession,
  getServerSession,
} from "trackfleet-auth-session-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot, type SendatrackCredentials } from "./sendatrack";
import { decodeSessionEncryptionKey } from "./session-encryption-key";

export type CompanySession = {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentials: SendatrackCredentials;
};

const cookieName = "__Host-trackfleet_session";
const sessionDurationSeconds = 7 * 24 * 60 * 60;

type StoredCredentials = {
  accountID: string;
  user: string;
  password: string;
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
    const dedicatedKey = decodeSessionEncryptionKey(encoded);
    if (!dedicatedKey) throw new Error("server_not_configured");
    raw = dedicatedKey;
  } else {
    const fallbackSecret = runtimeEnv.SENDATRACK_PASSWORD;
    if (!fallbackSecret) throw new Error("server_not_configured");
    raw = await sha256Bytes(`trackfleet-session:${fallbackSecret}`);
  }
  const keyMaterial = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptCredentials(credentials: StoredCredentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), plaintext);
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

async function decryptCredentials(value: string): Promise<StoredCredentials> {
  const [ivValue, ciphertextValue] = value.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("invalid_session");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await encryptionKey(),
    fromBase64(ciphertextValue),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<StoredCredentials>;
  if (typeof parsed.accountID !== "string" || typeof parsed.user !== "string" || typeof parsed.password !== "string") {
    throw new Error("invalid_session");
  }
  return { accountID: parsed.accountID, user: parsed.user, password: parsed.password };
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
  // Session tables are created lazily by the platform-specific server store.
}

export async function createCompanySession(credentials: SendatrackCredentials) {
  const normalized: StoredCredentials = {
    accountID: credentials.accountID.trim(),
    user: credentials.user.trim(),
    password: credentials.password,
  };
  if (!normalized.accountID || !normalized.user || !normalized.password) throw new Error("missing_credentials");

  const snapshot = await getSendatrackSnapshot(normalized);
  if (!snapshot.connected) throw new Error(snapshot.error === "authentication_failed" ? "authentication_failed" : "sendatrack_unavailable");

  const companyId = await sha256(`sendatrack-account:${normalized.accountID.toLowerCase()}`);
  const token = randomToken(32);
  const tokenHash = await sha256(`trackfleet-session-token:${token}`);
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000);

  let credentialsCiphertext: string;
  try {
    credentialsCiphertext = await encryptCredentials(normalized);
    console.info("[trackfleet:auth] credentials encrypted");
  } catch (error) {
    console.error("[trackfleet:auth] credential encryption failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    throw error;
  }

  try {
    await createServerSession({
      tokenHash,
      companyId,
      accountLabel: normalized.accountID,
      userLabel: normalized.user,
      credentialsCiphertext,
      expiresAt,
    });
    console.info("[trackfleet:auth] server session created");
  } catch (error) {
    console.error("[trackfleet:auth] server session creation failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    throw error;
  }

  return {
    cookie: `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    company: { account: normalized.accountID, user: normalized.user },
    vehicles: snapshot.vehicles,
  };
}

export async function getCompanySession(request: Request): Promise<CompanySession | null> {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return null;

  const token = cookieValue(request);
  if (!token) return null;
  try {
    const tokenHash = await sha256(`trackfleet-session-token:${token}`);
    const stored = await getServerSession(tokenHash);
    if (!stored) return null;
    if (stored.expiresAt.getTime() <= Date.now()) {
      await deleteServerSession(tokenHash).catch(() => undefined);
      return null;
    }

    const credentials = await decryptCredentials(stored.credentialsCiphertext);
    const expectedCompanyId = await sha256(`sendatrack-account:${credentials.accountID.toLowerCase()}`);
    if (expectedCompanyId !== stored.companyId) {
      await deleteServerSession(tokenHash).catch(() => undefined);
      return null;
    }

    return {
      companyId: stored.companyId,
      accountLabel: stored.accountLabel,
      userLabel: stored.userLabel,
      credentials,
    };
  } catch {
    return null;
  }
}

export async function deleteCompanySession(request: Request) {
  const token = cookieValue(request);
  if (token) {
    try {
      const tokenHash = await sha256(`trackfleet-session-token:${token}`);
      await deleteServerSession(tokenHash);
    } catch (error) {
      console.error("[trackfleet:auth] failed to delete server session", {
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function createTrackingToken() {
  return randomToken(18);
}
