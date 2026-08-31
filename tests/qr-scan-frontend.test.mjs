import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scanPage = await readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8");
const labelsPage = await readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");

test("the scan page requires an authenticated session, the same way /import does", () => {
  assert.match(scanPage, /fetch\("\/api\/auth\/session", \{ cache: "no-store" \}\)/);
  assert.match(scanPage, /if \(auth === "denied"\) return \(/);
});

test("the scanner exposes only the two warehouse handoffs: loading and hub unload", () => {
  for (const checkpoint of ["loaded", "arrived"]) {
    assert.match(scanPage, new RegExp(`value: "${checkpoint}"`));
  }
  assert.doesNotMatch(scanPage, /value: "departed"/);
  assert.doesNotMatch(scanPage, /value: "delivered"/);
  assert.match(scanPage, /Déchargé au hub/);
  assert.match(scanPage, /ne confirme jamais une arrivée finale/);
  assert.match(scanPage, /fetch\("\/api\/scan", \{/);
  assert.match(scanPage, /body: JSON\.stringify\(\{ parcelCode: code, checkpoint: modeRef\.current \}\)/);
});

test("a detected code is deduplicated client-side against the same code within the resubmit cooldown, independent of the server's own 30s duplicate window", () => {
  assert.match(scanPage, /const RESUBMIT_COOLDOWN_MS = 2500;/);
  assert.match(scanPage, /if \(last && last\.code === code && now - last\.at < RESUBMIT_COOLDOWN_MS\) return;/);
});

test("extractParcelCode accepts both the deep-link URL and a bare code -- a handheld Code128 scanner types the bare code, the phone's own camera app opens the URL", () => {
  assert.match(scanPage, /function extractParcelCode\(raw: string\): string \| null \{/);
  assert.match(scanPage, /const fromUrl = url\.searchParams\.get\("code"\);/);
});

test("the scan page prefers the native BarcodeDetector API and falls back to jsQR when it isn't available", () => {
  assert.match(scanPage, /BarcodeDetector\?: new \(options: \{ formats: string\[\] \}\) =>/);
  assert.match(scanPage, /if \(window\.BarcodeDetector\) \{/);
  assert.match(scanPage, /const \{ default: jsQR \} = await import\("jsqr"\);/);
});

test("a successful scan gives audio + vibration + visual feedback, and a duplicate scan is visually distinguished from a fresh one", () => {
  assert.match(scanPage, /function playBeep\(ok: boolean\)/);
  assert.match(scanPage, /if \(navigator\.vibrate\) navigator\.vibrate\(outcome === "duplicate" \? \[80, 60, 80\] : 150\);/);
  assert.match(scanPage, /const outcome: ScanOutcome = data\.duplicate \? "duplicate" : "success";/);
});

test("the manual code entry fallback pre-fills from a ?code= query param, for the deep-link-outside-the-app case", () => {
  assert.match(scanPage, /const code = new URLSearchParams\(window\.location\.search\)\.get\("code"\);/);
});

test("the labels page requires an authenticated session and loads only the requested delivery ids (or all, if none specified)", () => {
  assert.match(labelsPage, /fetch\("\/api\/auth\/session", \{ cache: "no-store" \}\)/);
  assert.match(labelsPage, /const ids = new Set\(new URLSearchParams\(window\.location\.search\)\.get\("ids"\)\?\.split\(","\)\.filter\(Boolean\) \?\? \[\]\);/);
});

test("the labels page renders A4-print CSS with break-inside protection per label, a page break between sheets, and a print button", () => {
  assert.match(labelsPage, /@page \{ size: A4; margin: 0; \}/);
  assert.match(labelsPage, /\.label \{ break-inside: avoid; \}/);
  assert.match(labelsPage, /\.label-page:not\(:last-child\) \{ break-after: page; \}/);
  assert.match(labelsPage, /onClick=\{\(\) => window\.print\(\)\}/);
});

test("labels are laid out 8 per A4 sheet (2x4) at ~105x74mm each, paginating into multiple sheets when there are more deliveries", () => {
  assert.match(labelsPage, /const LABELS_PER_ROW = 2;/);
  assert.match(labelsPage, /const LABELS_PER_COLUMN = 4;/);
  assert.match(labelsPage, /const LABEL_WIDTH_MM = 105;/);
  assert.match(labelsPage, /const LABEL_HEIGHT_MM = 74\.25;/);
  assert.match(labelsPage, /function chunk<T>\(items: T\[\], size: number\): T\[\]\[\] \{/);
  assert.match(labelsPage, /const pages = chunk\(deliveries, LABELS_PER_PAGE\);/);
});

test("each label shows the company's own logo and name from /api/company/branding, falling back to the TrackFleet wordmark when no logo is set", () => {
  assert.match(labelsPage, /fetch\("\/api\/company\/branding", \{ cache: "no-store" \}\)/);
  assert.match(labelsPage, /branding\.logoDataUrl && \(/);
  assert.match(labelsPage, /<img src=\{branding\.logoDataUrl\} alt="" /);
  assert.match(labelsPage, /\{branding\.name \|\| "TRACKFLEET"\}/);
});

test("each label renders a QR code (deep link) and a Code128 barcode from the same parcel code, generated client-side", () => {
  assert.match(labelsPage, /import\("qrcode"\)/);
  assert.match(labelsPage, /import\("jsbarcode"\)/);
  assert.match(labelsPage, /QRCode\.toCanvas\(qrCanvas, parcelScanUrl\(origin, delivery\.parcelCode\), \{ width: 160, margin: 1 \}\)/);
  assert.match(labelsPage, /JsBarcode\(barcodeCanvas, delivery\.parcelCode, \{ format: "CODE128"/);
});

test("a delivery with no parcel code (created before this feature existed) shows a placeholder instead of a broken QR", () => {
  assert.match(labelsPage, /Code non disponible/);
  assert.match(labelsPage, /delivery\.parcelCode \? \(/);
});

test("the label prints TrackFleet id, client, destination and truck, per the product spec's minimum label contents", () => {
  assert.match(labelsPage, /\{delivery\.id\}/);
  assert.match(labelsPage, /\{delivery\.customer\}/);
  assert.match(labelsPage, /→ \{delivery\.destination\}/);
  assert.match(labelsPage, /delivery\.truck && <div[^>]*>Camion : \{delivery\.truck\}<\/div>/);
});

test("the dashboard sidebar links to the scanner for both dispatcher and agency roles, not gated to dispatcher-only like the delete/export tools", () => {
  assert.match(dashboard, /<a className="nav-item" href="\/scan"><Icon>▦<\/Icon>\{t\.scanTool\}<\/a>/);
  assert.match(i18n, /scanTool: "Scan",/);
  assert.match(i18n, /scanTool: "Scanner",/);
  assert.match(i18n, /scanTool: "Scannen",/);
});

test("a dispatcher can print one delivery's label directly from its table row", () => {
  assert.match(dashboard, /window\.open\(`\/labels\?ids=\$\{delivery\.id\}`, "_blank"\)/);
});

test("bulk label selection: a checkbox per row (dispatcher only) feeds a toolbar button that opens /labels with every selected id, then clears the selection", () => {
  assert.match(dashboard, /const \[selectedForLabels, setSelectedForLabels\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(dashboard, /className="label-select-checkbox"/);
  assert.match(dashboard, /window\.open\(`\/labels\?ids=\$\{Array\.from\(selectedForLabels\)\.join\(","\)\}`, "_blank"\); setSelectedForLabels\(new Set\(\)\);/);
});

test("the delivery table shows both handoff proofs without claiming that the hub scan is final delivery", () => {
  assert.match(dashboard, /Contrôle colis/);
  assert.match(dashboard, /scanSummary\?\.loadedAt/);
  assert.match(dashboard, /scanSummary\?\.hubArrivedAt/);
  assert.match(dashboard, /scanSummary\?\.hubLabel/);
  assert.match(dashboard, /scan-control-cell/);
});
