import {
  createServerSession,
  deleteServerSession,
  getServerSession,
} from "trackfleet-auth-session-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot, type SendatrackCredentials } from "./sendatrack";
import { decodeSessionEncryptionKey } from "./session-encryption-key";
import { knownSite } from "./known-sites";
import { agencySiteIdFromUserLabel, agencyUserPrefix } from "./agency-access";

export type SessionAccess =
  | { role: "dispatcher"; siteId: null }
  | { role: "agency"; siteId: string };

export type CompanySession = SessionAccess & {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentials: SendatrackCredentials;
};

const cookieName = "__Host-trackfleet_session";
const sessionDurationSeconds = 7 * 24 * 60 * 60;
const agencyEnrollmentDurationMs = 30 * 60 * 1000;

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
  const raw = await sessionSecretBytes();
  const keyMaterial = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sessionSecretBytes() {
  const encoded = runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim();
  if (encoded) {
    const dedicatedKey = decodeSessionEncryptionKey(encoded);
    if (!dedicatedKey) throw new Error("server_not_configured");
    return dedicatedKey;
  }
  const fallbackSecret = runtimeEnv.SENDATRACK_PASSWORD;
  if (!fallbackSecret) throw new Error("server_not_configured");
  return sha256Bytes(`trackfleet-session:${fallbackSecret}`);
}

async function agencySigningKey() {
  const raw = await sessionSecretBytes();
  const keyMaterial = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
    company: { account: normalized.accountID, user: normalized.user, role: "dispatcher" as const, siteId: null },
    vehicles: snapshot.vehicles,
  };
}

type AgencyEnrollmentPayload = {
  version: 1;
  companyId: string;
  accountLabel: string;
  siteId: string;
  expiresAt: number;
  nonce: string;
  credentialsCiphertext: string;
};

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function signAgencyPayload(encodedPayload: string) {
  const signature = await crypto.subtle.sign("HMAC", await agencySigningKey(), new TextEncoder().encode(encodedPayload));
  return toBase64(new Uint8Array(signature));
}

export async function createAgencyEnrollmentToken(session: CompanySession, siteId: string) {
  if (session.role !== "dispatcher" || !knownSite(siteId)) throw new Error("agency_enrollment_not_allowed");
  const payload: AgencyEnrollmentPayload = {
    version: 1,
    companyId: session.companyId,
    accountLabel: session.accountLabel,
    siteId,
    expiresAt: Date.now() + agencyEnrollmentDurationMs,
    nonce: randomToken(12),
    credentialsCiphertext: await encryptCredentials({
      accountID: session.credentials.accountID,
      user: session.credentials.user,
      password: session.credentials.password,
    }),
  };
  const encodedPayload = toBase64(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await signAgencyPayload(encodedPayload)}`;
}

async function verifyAgencyEnrollmentToken(token: string): Promise<AgencyEnrollmentPayload> {
  const [encodedPayload, suppliedSignature] = token.split(".");
  if (!encodedPayload || !suppliedSignature || token.length > 2_000) throw new Error("invalid_agency_enrollment");
  const expectedSignature = await signAgencyPayload(encodedPayload);
  if (!bytesEqual(fromBase64(suppliedSignature), fromBase64(expectedSignature))) throw new Error("invalid_agency_enrollment");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64(encodedPayload))) as Partial<AgencyEnrollmentPayload>;
  if (
    payload.version !== 1
    || typeof payload.companyId !== "string"
    || typeof payload.accountLabel !== "string"
    || typeof payload.siteId !== "string"
    || typeof payload.expiresAt !== "number"
    || typeof payload.nonce !== "string"
    || typeof payload.credentialsCiphertext !== "string"
    || payload.expiresAt < Date.now()
    || payload.expiresAt > Date.now() + agencyEnrollmentDurationMs
    || !knownSite(payload.siteId)
  ) throw new Error("invalid_agency_enrollment");
  const expectedCompanyId = await sha256(`sendatrack-account:${payload.accountLabel.toLowerCase()}`);
  if (expectedCompanyId !== payload.companyId) throw new Error("invalid_agency_enrollment");
  return payload as AgencyEnrollmentPayload;
}

export async function createAgencySessionFromEnrollment(token: string) {
  const enrollment = await verifyAgencyEnrollmentToken(token);
  const providerCredentials = await decryptCredentials(enrollment.credentialsCiphertext);
  const sessionToken = randomToken(32);
  const tokenHash = await sha256(`trackfleet-session-token:${sessionToken}`);
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000);
  if (providerCredentials.accountID.toLowerCase() !== enrollment.accountLabel.toLowerCase()) throw new Error("invalid_agency_enrollment");
  const credentialsCiphertext = await encryptCredentials(providerCredentials);
  await createServerSession({
    tokenHash,
    companyId: enrollment.companyId,
    accountLabel: enrollment.accountLabel,
    userLabel: `${agencyUserPrefix}${enrollment.siteId}`,
    credentialsCiphertext,
    expiresAt,
  });
  return {
    cookie: `${cookieName}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    company: { account: enrollment.accountLabel, user: enrollment.siteId, role: "agency" as const, siteId: enrollment.siteId },
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

    const agencySiteId = agencySiteIdFromUserLabel(stored.userLabel);

    return {
      companyId: stored.companyId,
      accountLabel: stored.accountLabel,
      userLabel: stored.userLabel,
      credentials,
      ...(agencySiteId
        ? { role: "agency" as const, siteId: agencySiteId }
        : { role: "dispatcher" as const, siteId: null }),
    };
  } catch {
    return null;
  }
}

export async function getDispatcherSession(request: Request) {
  const session = await getCompanySession(request);
  return session?.role === "dispatcher" ? session : null;
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
