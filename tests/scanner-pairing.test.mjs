import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pairing = await readFile(new URL("../app/lib/scanner-pairing.ts", import.meta.url), "utf8");
const pairRoute = await readFile(new URL("../app/api/scan/pair/route.ts", import.meta.url), "utf8");
const consumeRoute = await readFile(new URL("../app/api/scan/pair/consume/route.ts", import.meta.url), "utf8");
const scannerSessionRoute = await readFile(new URL("../app/api/scan/session/route.ts", import.meta.url), "utf8");
const scanRoute = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const connectPage = await readFile(new URL("../app/scan/connect/page.tsx", import.meta.url), "utf8");

test("scanner pairing is a separate, HttpOnly scanner-only session with a short one-time QR and a bounded device lifetime", () => {
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

test("each hub can invalidate its active scanner and the connect page renders a QR plus a disconnect control", () => {
  assert.match(pairing, /await cache\.put\(activeKey\(record\), record\.id/);
  assert.match(pairing, /await cache\.delete\(activeKey\(session\)\);/);
  assert.match(connectPage, /QRCode\.toCanvas/);
  assert.match(connectPage, /Déconnecter le téléphone/);
  assert.match(connectPage, /Valable 10 minutes/);
});
