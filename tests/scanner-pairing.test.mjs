import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pairing = await readFile(new URL("../app/lib/scanner-pairing.ts", import.meta.url), "utf8");
const pairRoute = await readFile(new URL("../app/api/scan/pair/route.ts", import.meta.url), "utf8");
const consumeRoute = await readFile(new URL("../app/api/scan/pair/consume/route.ts", import.meta.url), "utf8");
const scannerSessionRoute = await readFile(new URL("../app/api/scan/session/route.ts", import.meta.url), "utf8");
const scanRoute = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const connectPage = await readFile(new URL("../app/scan/connect/page.tsx", import.meta.url), "utf8");

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
  assert.match(scanRoute, /await getScannerSession\(request\) \?\? await getCompanySession\(request\)/);
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
  assert.match(pairing, /export async function createScannerPairing\(session: CompanySession, deviceLabel: string\)/);
  assert.match(pairing, /export async function listScannerDevices\(session: CompanySession\)/);
  assert.match(pairing, /export async function revokeScannerDevice\(session: CompanySession, deviceId: string\)/);
  assert.doesNotMatch(pairing, /export async function revokeScannerFor/);
  assert.match(pairing, /devices\.push\(\{ id: record\.id, deviceLabel: record\.deviceLabel, pairedAt: sessionRecord\.pairedAt, expiresAt: sessionRecord\.expiresAt \}\);/);
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
  assert.match(scannerSessionRoute, /deviceLabel: scanner\?\.deviceLabel \?\? null,/);
});
