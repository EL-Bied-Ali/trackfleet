import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pairing = await readFile(new URL("../app/lib/scanner-pairing.ts", import.meta.url), "utf8");
const pairRoute = await readFile(new URL("../app/api/scan/pair/route.ts", import.meta.url), "utf8");
const consumeRoute = await readFile(new URL("../app/api/scan/pair/consume/route.ts", import.meta.url), "utf8");
const scannerSessionRoute = await readFile(new URL("../app/api/scan/session/route.ts", import.meta.url), "utf8");
const scanRoute = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const connectPage = await readFile(new URL("../app/scan/connect/page.tsx", import.meta.url), "utf8");
const scanPage = await readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8");

test("scanner pairing is a separate, HttpOnly scanner-only session with a short one-time link and a 30-day device lifetime", () => {
  assert.match(pairing, /const scannerCookieName = "__Host-trackfleet_scanner";/);
  assert.match(pairing, /const pairingLifetimeSeconds = 10 \* 60;/);
  assert.match(pairing, /const scannerLifetimeSeconds = 30 \* 24 \* 60 \* 60;/);
  assert.match(pairing, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(pairing, /await cache\.delete\(key\);/);
  assert.match(pairing, /scannerOnly: true/);
});

test("only the scan endpoints accept the paired phone, while the issuer must hold a normal same-origin company session", () => {
  assert.match(pairRoute, /requestIsSameOrigin\(request\)/);
  assert.match(pairRoute, /await getCompanySession\(request\)/);
  assert.match(consumeRoute, /requestIsSameOrigin\(request\)/);
  assert.match(scannerSessionRoute, /await getScannerSession\(request\)/);
  assert.match(scanRoute, /const scannerResult = await getScannerSession\(request\);\s*\n\s*const session = scannerResult\?\.session \?\? await getCompanySession\(request\);/);
  assert.doesNotMatch(pairing, /credentialsCiphertext|password|SENDATRACK_PASSWORD/);
});

// Live request: "I wanna make it as easy as possible for the truck
// conductor, maybe if we send them the link for scanning once and he keep
// it for himself always valid for him" -- confirmed as needing MULTIPLE
// drivers, each scanning at the same time from their own phone. The old
// model tracked exactly one "active" scanner id per company/site scope, so
// pairing a second driver's phone silently kicked the first one's session
// out. Each device now gets its own named, independently-revocable
// pairing, scoped the same way the old single slot was (a dispatcher's
// central account, or one specific agency site) so an agency still can't
// see or revoke another agency's or the dispatcher's devices.
test("multiple devices can be paired at once under the same scope, each named and independently listed/revocable, instead of one silently kicking another out", () => {
  assert.match(pairing, /function deviceListKey\(companyId: string, siteId: string \| null\) \{/);
  assert.match(pairing, /return `scanner-devices:\$\{companyId\}:\$\{siteId \?\? "dispatcher"\}`;/);
  assert.match(pairing, /export async function createScannerPairing\(session: CompanySession, deviceLabel: string, checkpoint: DeliveryScanCheckpoint \| null = null\)/);
  assert.match(pairing, /export async function listScannerDevices\(session: CompanySession\)/);
  assert.match(pairing, /export async function revokeScannerDevice\(session: CompanySession, deviceId: string\)/);
  assert.doesNotMatch(pairing, /export async function revokeScannerFor/);
  assert.match(pairing, /devices\.push\(\{ id: record\.id, deviceLabel: record\.deviceLabel, pairedAt: sessionRecord\.pairedAt, expiresAt: sessionRecord\.expiresAt, checkpoint: record\.checkpoint \?\? null \}\);/);
});

test("a pairing requires a device label, and the connect page collects one before generating a QR", () => {
  assert.match(pairing, /const trimmedLabel = deviceLabel\.trim\(\)\.slice\(0, maxDeviceLabelLength\);/);
  assert.match(pairing, /if \(!trimmedLabel\) throw new Error\("device_label_required"\);/);
  assert.match(pairRoute, /const deviceLabel = String\(payload\.deviceLabel \?\? ""\)\.trim\(\);/);
  assert.match(pairRoute, /if \(!deviceLabel\) return json\(\{ error: "device_label_required" \}, 400\);/);
  assert.match(connectPage, /placeholder="Nom de l.appareil \(ex\. : Ahmed - Camion 3\)"/);
});

test("the connect page lists every currently paired device with its own disconnect control, and revoking one requires its specific deviceId", () => {
  assert.match(pairRoute, /export async function GET\(request: Request\) \{/);
  assert.match(pairRoute, /const devices = await listScannerDevices\(session\);/);
  assert.match(pairRoute, /const deviceId = String\(payload\.deviceId \?\? ""\)\.trim\(\);/);
  assert.match(pairRoute, /if \(!deviceId\) return json\(\{ error: "device_id_required" \}, 400\);/);
  assert.match(connectPage, /APPAREILS CONNECTÉS/);
  assert.match(connectPage, /Déconnecter/);
  assert.match(connectPage, /QRCode\.toCanvas/);
});

test("the paired phone's own screen can show which named device it's connected as", () => {
  assert.match(scannerSessionRoute, /deviceLabel: scannerResult\?\.session\.deviceLabel \?\? null,/);
});

// Live follow-up: "if he use it before 30 days does it reset ?" -> "go for
// it". A device actually in regular use should never need a fresh link --
// the fixed one-time 30-day countdown from pairing is replaced with a
// sliding window that extends back out to a full 30 days once more than a
// day has already elapsed, on every authenticated check. Throttled (not
// on every single request) to keep KV writes bounded, matching this
// codebase's own past write-volume incidents.
test("a session due for refresh (more than a day into its 30-day window) gets both its KV record and its device-list entry extended, plus a fresh Set-Cookie for the browser's own copy of the expiry", () => {
  assert.match(pairing, /const refreshThresholdSeconds = 24 \* 60 \* 60;/);
  assert.match(pairing, /async function refreshScannerSession\(cache: ScannerKv, record: ScannerRecord\): Promise<string> \{/);
  assert.match(pairing, /const expiresAt = Date\.now\(\) \+ scannerLifetimeSeconds \* 1000;/);
  assert.match(pairing, /const dueForRefresh = record\.expiresAt - Date\.now\(\) < \(scannerLifetimeSeconds - refreshThresholdSeconds\) \* 1000;/);
  assert.match(pairing, /const refreshedCookie = dueForRefresh \? await refreshScannerSession\(cache, record\) : null;/);
  assert.match(pairing, /return \{ session: toScannerSession\(record\), refreshedCookie \};/);
});

test("a refreshed cookie rides along on whatever response the scan/session endpoints end up returning, so the browser actually keeps the extended session", () => {
  assert.match(scanRoute, /const refreshHeaders = scannerResult\?\.refreshedCookie \? \{ "set-cookie": scannerResult\.refreshedCookie \} : undefined;/);
  assert.match(scanRoute, /function noStore\(body: Record<string, unknown>, status = 200, extraHeaders\?: Record<string, string>\) \{/);
  assert.match(scannerSessionRoute, /if \(scannerResult\?\.refreshedCookie\) headers\["set-cookie"\] = scannerResult\.refreshedCookie;/);
});

// Live request: "l'employé qui reçoit le lien doit choisir où c'est, hub
// agence ou chargement, ça peut porter à confusion" -- a device paired for
// one fixed post should never make its user pick a checkpoint at all.
test("a pairing's checkpoint is optional and additive to the existing record shape, so an already-paired device with no checkpoint keeps today's free-choice behavior", () => {
  assert.match(pairing, /checkpoint\?: DeliveryScanCheckpoint \| null;/);
  assert.match(pairing, /const checkpoint = record\.checkpoint;/);
  assert.match(pairing, /if \(checkpoint != null && !validCheckpoints\.includes\(checkpoint\)\) return null;/);
  assert.match(pairing, /return \{ \.\.\.record, checkpoint: checkpoint \?\? null \} as ScannerRecord;/);
  // Bumping `version` would reject every already-stored record on next
  // read (see the version check just above in parseRecord), forcing every
  // currently-paired device to re-pair -- the field was added without
  // touching version 2 specifically to avoid that.
  assert.match(pairing, /record\.version !== 2/);
});

test("createScannerPairing validates the checkpoint and rejects a value outside the three known ones", () => {
  assert.match(pairing, /if \(checkpoint != null && !validCheckpoints\.includes\(checkpoint\)\) throw new Error\("invalid_checkpoint"\);/);
  assert.match(pairRoute, /if \(rawCheckpoint != null && !validCheckpoints\.includes\(rawCheckpoint as DeliveryScanCheckpoint\)\) \{\s*\n\s*return json\(\{ error: "invalid_checkpoint" \}, 400\);/);
});

test("the paired phone's own screen can read which checkpoint it's locked to, alongside its device label", () => {
  assert.match(scannerSessionRoute, /checkpoint: scannerResult\?\.session\.checkpoint \?\? null,/);
});

test("the scan endpoint enforces a device's checkpoint lock server-side, not just by hiding the picker client-side", () => {
  assert.match(scanRoute, /const lockedCheckpoint = scannerResult\?\.session\.checkpoint;/);
  assert.match(scanRoute, /if \(lockedCheckpoint && checkpoint !== lockedCheckpoint\) \{\s*\n\s*return noStore\(\{ error: "checkpoint_locked", lockedCheckpoint \}, 403, refreshHeaders\);/);
});

test("the scan page hides the checkpoint picker entirely for a locked device, pre-selects its mode, and surfaces a clear locked error if the server ever rejects a mismatch", () => {
  assert.match(scanPage, /const \[lockedCheckpoint, setLockedCheckpoint\] = useState<Checkpoint \| null>\(null\);/);
  assert.match(scanPage, /if \(data\.checkpoint\) \{\s*\n\s*setLockedCheckpoint\(data\.checkpoint\);\s*\n\s*setMode\(data\.checkpoint\);/);
  assert.match(scanPage, /\{lockedCheckpoint \? \(/);
  assert.match(scanPage, /data\.error === "checkpoint_locked" \? "Cet appareil est réservé à un autre poste\."/);
});

test("the connect page requires a checkpoint choice before generating a link, sends it to the pairing endpoint, and offers a one-click copy button for the resulting link", () => {
  assert.match(connectPage, /if \(!checkpointDraft\) \{\s*\n\s*setMessage\("Choisissez le poste de cet appareil \(chargement, hub ou agence\)\."\);/);
  assert.match(connectPage, /body: JSON\.stringify\(\{ deviceLabel, checkpoint: checkpointDraft \}\),/);
  assert.match(connectPage, /async function copyLink\(url: string\) \{/);
  assert.match(connectPage, /await navigator\.clipboard\.writeText\(url\);/);
  assert.match(connectPage, /\{copied \? "Copié ✓" : "Copier"\}/);
});
