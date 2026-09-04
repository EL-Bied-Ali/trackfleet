import { runtimeEnv } from "trackfleet-runtime-env";
import type { CompanySession } from "./company-auth";
import type { DeliveryScanCheckpoint } from "./delivery-store.types";

const scannerCookieName = "__Host-trackfleet_scanner";
const pairingLifetimeSeconds = 10 * 60;
const scannerLifetimeSeconds = 30 * 24 * 60 * 60;
// A device that's actually in regular use should never need a fresh link,
// per live feedback ("if he use it before 30 days does it reset?" -> "go
// for it"): every check now extends the window back out to a full 30 days
// once more than a day of it has already elapsed, instead of counting down
// once from the original pairing regardless of use. Throttled to roughly
// once per day of activity (not on every single request) to avoid a KV
// write -- and a browser Set-Cookie -- on every scan; this codebase has
// hit real KV/D1 write-volume ceilings before (see
// project_d1_write_volume_fix in memory).
const refreshThresholdSeconds = 24 * 60 * 60;
const maxDeviceLabelLength = 60;

type ScannerKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

type ScannerRecord = {
  version: 2;
  id: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  siteId: string | null;
  deviceLabel: string;
  pairedAt: number;
  expiresAt: number;
  // Optional and additive to the existing version 2 shape on purpose --
  // bumping the version would reject every already-paired device's stored
  // record on next read (see parseRecord below), forcing everyone to
  // re-pair. A record with no checkpoint (every one created before this)
  // keeps today's behavior: the scanning phone picks freely each time.
  // Live feedback: "l'employé qui reçoit le lien doit choisir où c'est,
  // hub agence ou chargement, ça peut porter à confusion" -- a device
  // meant for one fixed post (a hub's own tablet, an agency's own phone)
  // shouldn't make its user choose at all.
  checkpoint?: DeliveryScanCheckpoint | null;
};

const validCheckpoints: DeliveryScanCheckpoint[] = ["loaded", "arrived", "delivered"];

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

// Every driver pairs their own phone under this scope (a dispatcher's
// central account, or one specific agency site) -- kept at the same
// granularity the old single-slot "activeKey" used, so an agency still
// only ever sees/manages its own drivers' devices, never another agency's
// or the dispatcher's. Multiple truck conductors need to scan at the same
// time, each from their own phone (live request: "je wanna make it as
// easy as possible for the truck conductor... always valid for him"),
// which the old model didn't support -- pairing a second device silently
// kicked the first one out, since it only ever tracked ONE active id per
// scope. This now tracks a list instead.
function deviceListKey(companyId: string, siteId: string | null) {
  return `scanner-devices:${companyId}:${siteId ?? "dispatcher"}`;
}

function pairingKey(code: string) { return `scanner-pair:${code}`; }
function sessionKey(id: string) { return `scanner-session:${id}`; }
function scannerCookie(id: string) {
  return `${scannerCookieName}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${scannerLifetimeSeconds}`;
}

function parseRecord(value: string | null): ScannerRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Partial<ScannerRecord>;
    if (record.version !== 2 || typeof record.id !== "string" || typeof record.companyId !== "string"
      || typeof record.accountLabel !== "string" || typeof record.userLabel !== "string"
      || (record.siteId !== null && typeof record.siteId !== "string")
      || typeof record.deviceLabel !== "string" || typeof record.pairedAt !== "number"
      || typeof record.expiresAt !== "number" || record.expiresAt <= Date.now()) return null;
    const checkpoint = record.checkpoint;
    if (checkpoint != null && !validCheckpoints.includes(checkpoint)) return null;
    return { ...record, checkpoint: checkpoint ?? null } as ScannerRecord;
  } catch {
    return null;
  }
}

type DeviceListEntry = { id: string; deviceLabel: string; pairedAt: number; expiresAt: number; checkpoint: DeliveryScanCheckpoint | null };

async function readDeviceList(cache: ScannerKv, companyId: string, siteId: string | null): Promise<DeviceListEntry[]> {
  try {
    const raw = await cache.get(deviceListKey(companyId, siteId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // Self-pruning: an entry whose own session already expired (the
    // device never reconnected to trigger an explicit revoke) is simply
    // dropped from the list next time anyone reads it, rather than
    // needing a separate cleanup job.
    return parsed
      .filter((entry): entry is Omit<DeviceListEntry, "checkpoint"> & { checkpoint?: DeliveryScanCheckpoint | null } =>
        entry && typeof entry.id === "string" && typeof entry.deviceLabel === "string"
        && typeof entry.pairedAt === "number" && typeof entry.expiresAt === "number" && entry.expiresAt > Date.now())
      // Entries written before this field existed have no `checkpoint` key
      // at all -- normalize to null rather than leaving it undefined.
      .map((entry) => ({ ...entry, checkpoint: entry.checkpoint ?? null }));
  } catch {
    return [];
  }
}

// Read-modify-write, not atomic -- acceptable here since pairing/revoking a
// device is a rare, deliberate action a dispatcher/agency takes in person,
// not a concurrent hot path (same tradeoff already made for the pairing
// code's own delete-then-write above).
async function writeDeviceList(cache: ScannerKv, companyId: string, siteId: string | null, entries: DeviceListEntry[]) {
  await cache.put(deviceListKey(companyId, siteId), JSON.stringify(entries));
}

export type ScannerSession = Pick<ScannerRecord, "companyId" | "accountLabel" | "userLabel" | "deviceLabel"> & ({
  role: "dispatcher";
  siteId: null;
} | {
  role: "agency";
  siteId: string;
}) & { scannerOnly: true; checkpoint: DeliveryScanCheckpoint | null };

export async function createScannerPairing(session: CompanySession, deviceLabel: string, checkpoint: DeliveryScanCheckpoint | null = null) {
  const trimmedLabel = deviceLabel.trim().slice(0, maxDeviceLabelLength);
  if (!trimmedLabel) throw new Error("device_label_required");
  if (checkpoint != null && !validCheckpoints.includes(checkpoint)) throw new Error("invalid_checkpoint");
  const cache = kv();
  if (!cache) throw new Error("scanner_pairing_unavailable");
  const code = token();
  const record: ScannerRecord = {
    version: 2,
    id: token(),
    companyId: session.companyId,
    accountLabel: session.accountLabel,
    userLabel: session.userLabel,
    siteId: session.siteId,
    deviceLabel: trimmedLabel,
    pairedAt: Date.now(),
    expiresAt: Date.now() + pairingLifetimeSeconds * 1000,
    checkpoint,
  };
  await cache.put(pairingKey(code), JSON.stringify(record), { expirationTtl: pairingLifetimeSeconds });
  return { code, expiresAt: record.expiresAt, deviceLabel: trimmedLabel, checkpoint };
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
  const sessionRecord: ScannerRecord = { ...record, expiresAt: Date.now() + scannerLifetimeSeconds * 1000 };
  await cache.put(sessionKey(record.id), JSON.stringify(sessionRecord), { expirationTtl: scannerLifetimeSeconds });
  const devices = await readDeviceList(cache, record.companyId, record.siteId);
  devices.push({ id: record.id, deviceLabel: record.deviceLabel, pairedAt: sessionRecord.pairedAt, expiresAt: sessionRecord.expiresAt, checkpoint: record.checkpoint ?? null });
  await writeDeviceList(cache, record.companyId, record.siteId, devices);
  return {
    cookie: scannerCookie(record.id),
    session: toScannerSession(sessionRecord),
  };
}

function toScannerSession(record: ScannerRecord): ScannerSession {
  const shared = { companyId: record.companyId, accountLabel: record.accountLabel, userLabel: record.userLabel, deviceLabel: record.deviceLabel, scannerOnly: true as const, checkpoint: record.checkpoint ?? null };
  return record.siteId ? { ...shared, role: "agency", siteId: record.siteId } : { ...shared, role: "dispatcher", siteId: null };
}

// Rewrites the session (and its device-list entry) back out to a full
// scannerLifetimeSeconds from now, and returns a fresh Set-Cookie for the
// browser to extend its own copy of the expiry too -- refreshing only the
// server-side KV record wouldn't be enough, since the cookie's Max-Age was
// fixed at the moment it was first issued and the browser will drop it on
// schedule regardless of what the server thinks is still valid.
async function refreshScannerSession(cache: ScannerKv, record: ScannerRecord): Promise<string> {
  const expiresAt = Date.now() + scannerLifetimeSeconds * 1000;
  const refreshed: ScannerRecord = { ...record, expiresAt };
  await cache.put(sessionKey(record.id), JSON.stringify(refreshed), { expirationTtl: scannerLifetimeSeconds });
  const devices = await readDeviceList(cache, record.companyId, record.siteId);
  const updatedDevices = devices.map((entry) => entry.id === record.id ? { ...entry, expiresAt } : entry);
  await writeDeviceList(cache, record.companyId, record.siteId, updatedDevices);
  return scannerCookie(record.id);
}

export type ScannerSessionResult = { session: ScannerSession; refreshedCookie: string | null };

export async function getScannerSession(request: Request): Promise<ScannerSessionResult | null> {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return null;
  const cache = kv();
  const id = cookieValue(request);
  if (!cache || !id || id.length > 128) return null;
  const record = parseRecord(await cache.get(sessionKey(id)));
  if (!record || record.id !== id) return null;
  const dueForRefresh = record.expiresAt - Date.now() < (scannerLifetimeSeconds - refreshThresholdSeconds) * 1000;
  const refreshedCookie = dueForRefresh ? await refreshScannerSession(cache, record) : null;
  return { session: toScannerSession(record), refreshedCookie };
}

// Lists every phone currently paired under this session's own scope
// (dispatcher-central, or this exact agency site) so a dispatcher/agency
// can see who's connected and revoke a specific device -- e.g. a driver who
// left, or a lost phone -- without touching anyone else's.
export async function listScannerDevices(session: CompanySession) {
  const cache = kv();
  if (!cache) throw new Error("scanner_pairing_unavailable");
  return readDeviceList(cache, session.companyId, session.siteId);
}

export async function revokeScannerDevice(session: CompanySession, deviceId: string) {
  const cache = kv();
  if (!cache) throw new Error("scanner_pairing_unavailable");
  const devices = await readDeviceList(cache, session.companyId, session.siteId);
  const target = devices.find((entry) => entry.id === deviceId);
  if (!target) return false;
  await cache.delete(sessionKey(deviceId));
  await writeDeviceList(cache, session.companyId, session.siteId, devices.filter((entry) => entry.id !== deviceId));
  return true;
}
