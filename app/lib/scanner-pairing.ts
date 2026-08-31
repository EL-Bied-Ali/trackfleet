import { runtimeEnv } from "trackfleet-runtime-env";
import type { CompanySession } from "./company-auth";

const scannerCookieName = "__Host-trackfleet_scanner";
const pairingLifetimeSeconds = 10 * 60;
const scannerLifetimeSeconds = 30 * 24 * 60 * 60;

type ScannerKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

type ScannerRecord = {
  version: 1;
  id: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  siteId: string | null;
  expiresAt: number;
};

function kv() {
  return (runtimeEnv as unknown as { SENDATRACK_TOKEN_CACHE?: ScannerKv }).SENDATRACK_TOKEN_CACHE ?? null;
}

function token(bytes = 18) {
  let binary = "";
  for (const value of crypto.getRandomValues(new Uint8Array(bytes))) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cookieValue(request: Request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === scannerCookieName) return value.join("=");
  }
  return "";
}

function activeKey(record: Pick<ScannerRecord, "companyId" | "siteId">) {
  return `scanner-active:${record.companyId}:${record.siteId ?? "dispatcher"}`;
}

function pairingKey(code: string) { return `scanner-pair:${code}`; }
function sessionKey(id: string) { return `scanner-session:${id}`; }

function parseRecord(value: string | null): ScannerRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Partial<ScannerRecord>;
    if (record.version !== 1 || typeof record.id !== "string" || typeof record.companyId !== "string"
      || typeof record.accountLabel !== "string" || typeof record.userLabel !== "string"
      || (record.siteId !== null && typeof record.siteId !== "string")
      || typeof record.expiresAt !== "number" || record.expiresAt <= Date.now()) return null;
    return record as ScannerRecord;
  } catch {
    return null;
  }
}

export type ScannerSession = Pick<ScannerRecord, "companyId" | "accountLabel" | "userLabel"> & ({
  role: "dispatcher";
  siteId: null;
} | {
  role: "agency";
  siteId: string;
}) & { scannerOnly: true };

export async function createScannerPairing(session: CompanySession) {
  const cache = kv();
  if (!cache) throw new Error("scanner_pairing_unavailable");
  const code = token();
  const record: ScannerRecord = {
    version: 1,
    id: token(),
    companyId: session.companyId,
    accountLabel: session.accountLabel,
    userLabel: session.userLabel,
    siteId: session.siteId,
    expiresAt: Date.now() + pairingLifetimeSeconds * 1000,
  };
  await cache.put(pairingKey(code), JSON.stringify(record), { expirationTtl: pairingLifetimeSeconds });
  return { code, expiresAt: record.expiresAt };
}

export async function consumeScannerPairing(code: string) {
  const cache = kv();
  if (!cache || !code || code.length > 128) return null;
  const key = pairingKey(code);
  const record = parseRecord(await cache.get(key));
  if (!record) return null;
  // This is intentionally best-effort on KV: the random, short-lived code is
  // already unguessable, and deleting it immediately prevents normal reuse.
  await cache.delete(key);
  await cache.put(sessionKey(record.id), JSON.stringify(record), { expirationTtl: scannerLifetimeSeconds });
  await cache.put(activeKey(record), record.id, { expirationTtl: scannerLifetimeSeconds });
  return {
    cookie: `${scannerCookieName}=${record.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${scannerLifetimeSeconds}`,
    session: toScannerSession(record),
  };
}

function toScannerSession(record: ScannerRecord): ScannerSession {
  const shared = { companyId: record.companyId, accountLabel: record.accountLabel, userLabel: record.userLabel, scannerOnly: true as const };
  return record.siteId ? { ...shared, role: "agency", siteId: record.siteId } : { ...shared, role: "dispatcher", siteId: null };
}

export async function getScannerSession(request: Request): Promise<ScannerSession | null> {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return null;
  const cache = kv();
  const id = cookieValue(request);
  if (!cache || !id || id.length > 128) return null;
  const record = parseRecord(await cache.get(sessionKey(id)));
  if (!record || record.id !== id) return null;
  return (await cache.get(activeKey(record))) === id ? toScannerSession(record) : null;
}

export async function revokeScannerFor(session: CompanySession) {
  const cache = kv();
  if (!cache) throw new Error("scanner_pairing_unavailable");
  await cache.delete(activeKey(session));
}
