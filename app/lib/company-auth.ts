import { env } from "cloudflare:workers";
import { getSendatrackSnapshot, type SendatrackCredentials } from "./sendatrack";

type RuntimeEnv = {
  DB: typeof env.DB;
  TRACKFLEET_ENCRYPTION_KEY?: string;
};

type CompanyRow = {
  id: string;
  account_label: string;
  user_label: string;
  credentials_ciphertext: string;
};

export type CompanySession = {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentials: SendatrackCredentials;
};

const runtimeEnv = env as unknown as RuntimeEnv;
const cookieName = "__Host-trackfleet_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(size = 32) {
  return toBase64(crypto.getRandomValues(new Uint8Array(size)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey() {
  const encoded = runtimeEnv.TRACKFLEET_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("server_not_configured");
  const raw = fromBase64(encoded);
  if (raw.byteLength !== 32) throw new Error("server_not_configured");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptCredentials(credentials: SendatrackCredentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), plaintext);
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

async function decryptCredentials(value: string): Promise<SendatrackCredentials> {
  const [ivValue, ciphertextValue] = value.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("invalid_credentials_store");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await encryptionKey(),
    fromBase64(ciphertextValue),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as SendatrackCredentials;
}

export async function ensureAuthTables() {
  const db = runtimeEnv.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS companies (
      id text PRIMARY KEY NOT NULL,
      account_label text NOT NULL,
      user_label text NOT NULL,
      credentials_ciphertext text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY NOT NULL,
      company_id text NOT NULL,
      expires_at integer NOT NULL,
      created_at integer NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"),
  ]);
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) return value.join("=");
  }
  return "";
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

  await ensureAuthTables();
  const companyId = await sha256(`sendatrack-account:${normalized.accountID.toLowerCase()}`);
  const encrypted = await encryptCredentials(normalized);
  const now = Date.now();
  await runtimeEnv.DB.prepare(`INSERT INTO companies (id, account_label, user_label, credentials_ciphertext, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET account_label = excluded.account_label, user_label = excluded.user_label,
      credentials_ciphertext = excluded.credentials_ciphertext, updated_at = excluded.updated_at`)
    .bind(companyId, normalized.accountID, normalized.user, encrypted, now, now)
    .run();

  const token = randomToken();
  const tokenHash = await sha256(token);
  await runtimeEnv.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  await runtimeEnv.DB.prepare("INSERT INTO sessions (token_hash, company_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, companyId, now + sessionDurationSeconds * 1000, now)
    .run();

  return {
    cookie: `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionDurationSeconds}`,
    company: { account: normalized.accountID, user: normalized.user },
    vehicles: snapshot.vehicles,
  };
}

export async function getCompanySession(request: Request): Promise<CompanySession | null> {
  const token = cookieValue(request);
  if (!token) return null;
  await ensureAuthTables();
  const tokenHash = await sha256(token);
  const row = await runtimeEnv.DB.prepare(`SELECT c.id, c.account_label, c.user_label, c.credentials_ciphertext
    FROM sessions s JOIN companies c ON c.id = s.company_id
    WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(tokenHash, Date.now())
    .first<CompanyRow>();
  if (!row) return null;
  try {
    return {
      companyId: row.id,
      accountLabel: row.account_label,
      userLabel: row.user_label,
      credentials: await decryptCredentials(row.credentials_ciphertext),
    };
  } catch {
    return null;
  }
}

export async function deleteCompanySession(request: Request) {
  const token = cookieValue(request);
  if (token) {
    await ensureAuthTables();
    await runtimeEnv.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function createTrackingToken() {
  return randomToken(18);
}
