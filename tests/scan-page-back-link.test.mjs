import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User report: "dans la page de scan le retour au tableau ne fonctionne
// pas". Root cause: a device paired purely for scanning (via
// /scan/connect's QR) only ever gets a scanner-scoped session
// (GET /api/scan/session returns scannerOnly: true), never a full
// dispatcher login -- clicking "← Tableau" (linking to "/") landed on the
// SENDATRACK login screen instead of a dashboard, since getCompanySession
// never accepts a scanner-only session. There's genuinely nothing to
// return to on that device, so the fix is to stop offering the link there.
const scanPage = await readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8");

test("captures scannerOnly from /api/scan/session's response", () => {
  assert.match(scanPage, /const \[scannerOnly, setScannerOnly\] = useState\(false\);/);
  assert.match(scanPage, /scannerOnly\?: boolean; company\?: CompanyInfo/);
  assert.match(scanPage, /setScannerOnly\(data\.scannerOnly === true\);/);
});

test("only shows the '← Tableau' link when this device has an actual dashboard session to return to", () => {
  assert.match(scanPage, /\{!scannerOnly && <Link href="\/\?lang=fr"/);
});
