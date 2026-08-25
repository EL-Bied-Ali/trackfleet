import {
  createServerSession,
  deleteServerSession,
  getServerSession,
  renewServerSession,
} from "trackfleet-auth-session-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { getSendatrackSnapshot, type SendatrackCredentials } from "./sendatrack";
import { decodeSessionEncryptionKey } from "./session-encryption-key";
import { knownSite } from "./known-sites";
import { agencySiteIdFromUserLabel, agencyUserPrefix } from "./agency-access";
import { grantTrialIfNewCompany } from "./subscription-store";

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
export const agencyEnrollmentDurationMs = 30 * 60 * 1000;

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

async function hmacSigningKey() {
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

export async function decryptCredentials(value: string): Promise<StoredCredentials> {
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

  // Awaited so it completes before the Worker's execution context could be
  // torn down after the response is sent, but its failure is caught rather
  // than propagated: a company's very first login must still succeed even
  // if this particular write fails (e.g. a transient Postgres blip) --
  // grantTrialIfNewCompany is idempotent (ON CONFLICT DO NOTHING), so the
  // very next login attempt tries again for free.
  await grantTrialIfNewCompany(companyId).catch((error) => {
    console.error("[trackfleet:auth] trial grant failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  });

  return {
    cookie: `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    company: { account: normalized.accountID, user: normalized.user, role: "dispatcher" as const, siteId: null },
    vehicles: snapshot.vehicles,
    companyId,
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

async function signHmacPayload(encodedPayload: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacSigningKey(), new TextEncoder().encode(encodedPayload));
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
  return `${encodedPayload}.${await signHmacPayload(encodedPayload)}`;
}

type GooglePendingLinkPayload = {
  version: 1;
  sub: string;
  email: string;
  expiresAt: number;
};

const googlePendingLinkDurationMs = 10 * 60 * 1000;

// A first-time Google sign-in with no existing google_links row can't be
// logged in yet -- it needs one round trip through the SENDATRACK-credential
// linking form first. Rather than persisting that half-authenticated state
// server-side, the verified Google identity travels in the same
// self-contained signed-token shape as agency enrollment above: short-lived,
// tamper-evident, no DB lookup needed to verify it.
export async function createGooglePendingLinkToken(identity: { sub: string; email: string }) {
  const payload: GooglePendingLinkPayload = {
    version: 1,
    sub: identity.sub,
    email: identity.email,
    expiresAt: Date.now() + googlePendingLinkDurationMs,
  };
  const encodedPayload = toBase64(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await signHmacPayload(encodedPayload)}`;
}

export async function verifyGooglePendingLinkToken(token: string): Promise<{ sub: string; email: string }> {
  const [encodedPayload, suppliedSignature] = token.split(".");
  if (!encodedPayload || !suppliedSignature || token.length > 2_000) throw new Error("invalid_google_link");
  const expectedSignature = await signHmacPayload(encodedPayload);
  if (!bytesEqual(fromBase64(suppliedSignature), fromBase64(expectedSignature))) throw new Error("invalid_google_link");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64(encodedPayload))) as Partial<GooglePendingLinkPayload>;
  if (
    payload.version !== 1
    || typeof payload.sub !== "string"
    || typeof payload.email !== "string"
    || typeof payload.expiresAt !== "number"
    || payload.expiresAt < Date.now()
  ) throw new Error("invalid_google_link");
  return { sub: payload.sub, email: payload.email };
}

// The full enrollment token is self-contained on purpose (companyId, siteId,
// expiry, and the encrypted SENDATRACK credentials, all signed) so it never
// needs a server-side lookup to verify -- but that also makes it a very
// long URL fragment, unwieldy to share over WhatsApp/SMS to an agency.
// Reuses the existing SENDATRACK_TOKEN_CACHE KV binding (a distinct key
// prefix, not the token cache itself) rather than provisioning a new
// namespace -- this repo's deploy token can't create Cloudflare resources
// from here. Same graceful-degradation shape as the token cache: KV is
// Cloudflare-only, so elsewhere this just means the short link isn't
// available and the caller falls back to the full token.
type EnrollmentLinkKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

function enrollmentLinkKv() {
  return (runtimeEnv as unknown as { SENDATRACK_TOKEN_CACHE?: EnrollmentLinkKv }).SENDATRACK_TOKEN_CACHE ?? null;
}

function enrollmentLinkKey(code: string) {
  return `agency-enroll-link:${code}`;
}

export async function createShortEnrollmentCode(token: string, expiresAt: number): Promise<string | null> {
  const kv = enrollmentLinkKv();
  if (!kv) return null;
  const ttlSeconds = Math.max(60, Math.ceil((expiresAt - Date.now()) / 1000));
  const code = randomToken(6);
  try {
    await kv.put(enrollmentLinkKey(code), token, { expirationTtl: ttlSeconds });
    return code;
  } catch (error) {
    console.error("[trackfleet:agency-enrollment] short link write failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

// Single-use: deleted as soon as it's read, on top of its own KV TTL. The
// long token it resolves to still carries its own expiry and signature, so
// this is a convenience/safety layer, not the only check.
export async function resolveShortEnrollmentCode(code: string): Promise<string | null> {
  const kv = enrollmentLinkKv();
  if (!kv || !code || code.length > 32) return null;
  try {
    const token = await kv.get(enrollmentLinkKey(code));
    if (token) await kv.delete(enrollmentLinkKey(code));
    return token;
  } catch (error) {
    console.error("[trackfleet:agency-enrollment] short link read failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

async function verifyAgencyEnrollmentToken(token: string): Promise<AgencyEnrollmentPayload> {
  const [encodedPayload, suppliedSignature] = token.split(".");
  if (!encodedPayload || !suppliedSignature || token.length > 2_000) throw new Error("invalid_agency_enrollment");
  const expectedSignature = await signHmacPayload(encodedPayload);
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

type ResolvedSession = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
  session: CompanySession;
};

async function resolveCompanySession(request: Request): Promise<ResolvedSession | null> {
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
      token,
      tokenHash,
      expiresAt: stored.expiresAt,
      session: {
        companyId: stored.companyId,
        accountLabel: stored.accountLabel,
        userLabel: stored.userLabel,
        credentials,
        ...(agencySiteId
          ? { role: "agency" as const, siteId: agencySiteId }
          : { role: "dispatcher" as const, siteId: null }),
      },
    };
  } catch {
    return null;
  }
}

export async function getCompanySession(request: Request): Promise<CompanySession | null> {
  const resolved = await resolveCompanySession(request);
  return resolved?.session ?? null;
}

// A session only needs its expiry pushed back out once it's gotten this
// close to expiring -- caps renewal writes to roughly once per day of
// active use instead of on every single request, while a user who opens
// the app at least once a week never actually hits the 7-day wall.
const sessionRenewalWindowSeconds = 24 * 60 * 60;

export async function getCompanySessionWithRenewal(request: Request): Promise<{ session: CompanySession; renewedCookie: string | null } | null> {
  const resolved = await resolveCompanySession(request);
  if (!resolved) return null;

  const remainingSeconds = (resolved.expiresAt.getTime() - Date.now()) / 1000;
  if (remainingSeconds >= sessionDurationSeconds - sessionRenewalWindowSeconds) {
    return { session: resolved.session, renewedCookie: null };
  }

  try {
    const newExpiresAt = new Date(Date.now() + sessionDurationSeconds * 1000);
    await renewServerSession(resolved.tokenHash, newExpiresAt);
    return {
      session: resolved.session,
      renewedCookie: `${cookieName}=${resolved.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    };
  } catch (error) {
    console.error("[trackfleet:auth] session renewal failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return { session: resolved.session, renewedCookie: null };
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
