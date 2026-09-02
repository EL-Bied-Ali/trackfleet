import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scanPage = await readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8");
const labelsPage = await readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const appSidebar = await readFile(new URL("../app/AppSidebar.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../app/i18n.ts", import.meta.url), "utf8");
const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

test("the scan page accepts either a normal session or a one-time QR pairing, then checks the scanner-only session endpoint", () => {
  assert.match(scanPage, /fetch\("\/api\/scan\/pair\/consume", \{/);
  assert.match(scanPage, /window\.history\.replaceState\(\{\}, "", "\/scan"\)/);
  assert.match(scanPage, /fetch\("\/api\/scan\/session", \{ cache: "no-store" \}\)/);
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

test("the labels page renders A4-print CSS with break-inside protection per label, a page break between sheets, and records the honest print-dialog action", () => {
  assert.match(labelsPage, /@page \{ size: A4; margin: 0; \}/);
  assert.match(labelsPage, /\.label \{ break-inside: avoid; \}/);
  assert.match(labelsPage, /\.label-page:not\(:last-child\) \{ break-after: page; \}/);
  assert.match(labelsPage, /async function handlePrint\(\)/);
  assert.match(labelsPage, /fetch\("\/api\/deliveries\/label-print", \{/);
  assert.match(labelsPage, /finally \{\s*window\.print\(\);\s*\}/);
});

// Reported live: label width/height were fixed constants, so matching an
// actual physical pre-cut sheet meant editing code and redeploying just to
// test a different size. Made editable directly on the page instead (two
// number inputs, remembered per browser via localStorage), with the A4
// per-page count recomputed from whatever size is currently set rather than
// assumed fixed at 8.
test("label width/height are editable on the page (not fixed constants), remembered via localStorage, and the per-page grid is computed from the current size", () => {
  assert.match(labelsPage, /const DEFAULT_LABEL_WIDTH_MM = 100;/);
  assert.match(labelsPage, /const DEFAULT_LABEL_HEIGHT_MM = 65;/);
  assert.match(labelsPage, /const LABEL_SIZE_STORAGE_KEY = "trackfleet-label-size-mm";/);
  assert.match(labelsPage, /const \[labelSize, setLabelSize\] = useState\(\(\) => readStoredLabelSize\(\)\);/);
  assert.match(labelsPage, /window\.localStorage\.setItem\(LABEL_SIZE_STORAGE_KEY, JSON\.stringify\(updated\)\);/);
  assert.match(labelsPage, /const labelsPerRow = Math\.max\(1, Math\.floor\(PAGE_WIDTH_MM \/ labelSize\.width\)\);/);
  assert.match(labelsPage, /const labelsPerColumn = Math\.max\(1, Math\.floor\(PAGE_HEIGHT_MM \/ labelSize\.height\)\);/);
  assert.match(labelsPage, /input type="number" min=\{MIN_LABEL_MM\} max=\{MAX_LABEL_MM\} step=\{1\} value=\{labelSize\.width\}/);
  assert.match(labelsPage, /input type="number" min=\{MIN_LABEL_MM\} max=\{MAX_LABEL_MM\} step=\{1\} value=\{labelSize\.height\}/);
  assert.match(labelsPage, /function layoutLabelPages<T>\(items: T\[\], labelsPerPage: number, blockedCells: Set<number>\): Array<Array<T \| null>> \{/);
  assert.match(labelsPage, /const pages = layoutLabelPages\(deliveries, labelsPerPage, blockedCells\);/);
});

test("each label shows the company's own logo and name from /api/company/branding, falling back to the TrackFleet wordmark when no logo is set", () => {
  assert.match(labelsPage, /fetch\("\/api\/company\/branding", \{ cache: "no-store" \}\)/);
  assert.match(labelsPage, /branding\.logoDataUrl && \(/);
  assert.match(labelsPage, /<img src=\{branding\.logoDataUrl\} alt="" /);
  assert.match(labelsPage, /\{branding\.name \|\| "TRACKFLEET"\}/);
});

test("each label renders a QR code (deep link) from the parcel code, generated client-side, with the raw code printed as plain text underneath for manual entry on /scan", () => {
  assert.match(labelsPage, /import\("qrcode"\)/);
  assert.match(labelsPage, /QRCode\.toCanvas\(qrCanvas, parcelScanUrl\(origin, delivery\.parcelCode\), \{ width: 160, margin: 1 \}\)/);
  assert.match(labelsPage, /<div style=\{\{ fontSize: 9, fontFamily: "monospace", letterSpacing: "\.05em", color: "#333" \}\}>\{delivery\.parcelCode\}<\/div>/);
});

// Reported live: the Code128 barcode only ever added value paired with a
// dedicated handheld barcode scanner, which nobody here owns -- the
// plain-text code (test above) already covers manual entry on /scan
// without any scanner at all, so the barcode image itself was dropped as
// pure duplication. jsbarcode is fully gone (not just unused) -- see
// package.json.
test("the Code128 barcode is gone -- no jsbarcode import, no JsBarcode call, no barcode canvas, and the dependency itself is removed", () => {
  assert.doesNotMatch(labelsPage, /import\("jsbarcode"\)/);
  assert.doesNotMatch(labelsPage, /JsBarcode\(/);
  assert.doesNotMatch(labelsPage, /barcodeCanvas/);
  assert.doesNotMatch(packageJson, /"jsbarcode"/);
  assert.doesNotMatch(packageJson, /"@types\/jsbarcode"/);
});

// Reported live via a screenshot: a big empty gap sat next to the logo,
// above the QR -- the label was a header row (logo+name) stacked on top of
// a content row (text+QR), so the QR only ever occupied the lower row
// while the header row's right side had nothing in it. Restructured into
// two real columns spanning the label's FULL height instead, so the
// QR/code column fills that space rather than leaving it blank.
test("the label is two columns spanning its full height (logo+text on the left, QR+code on the right), not a header row stacked on a content row", () => {
  assert.match(labelsPage, /className="label" style=\{\{ boxSizing: "border-box", border: "1px solid #000", padding: `\$\{labelPaddingMm\}mm`, display: "flex", gap: "3mm", overflow: "hidden" \}\}/);
  assert.doesNotMatch(labelsPage, /flexDirection: "column", gap: "1\.5mm", overflow: "hidden" \}\}>\s*\n\s*<div style=\{\{ display: "flex", alignItems: "center", gap: "3mm" \}\}>/);
});

// Reported live: presets should fully use the A4 sheet, not leave a
// leftover margin strip -- each divides 210/297mm exactly (cols/rows
// chosen so the division comes out even), rather than approximating a
// specific commercial label product (there's no single standard size).
test("label size presets divide the A4 sheet exactly, with no leftover margin, computed rather than hardcoded to one specific product", () => {
  assert.match(labelsPage, /const LABEL_PRESETS: Array<\{ cols: number; rows: number \}> = \[/);
  assert.match(labelsPage, /const presetWidth = Math\.floor\(\(PAGE_WIDTH_MM \/ preset\.cols\) \* 100\) \/ 100;/);
  assert.match(labelsPage, /const presetHeight = Math\.floor\(\(PAGE_HEIGHT_MM \/ preset\.rows\) \* 100\) \/ 100;/);
  assert.match(labelsPage, /onClick=\{\(\) => updateLabelSize\(\{ width: presetWidth, height: presetHeight \}\)\}/);
});

test("a delivery with no parcel code (created before this feature existed) shows a placeholder instead of a broken QR", () => {
  assert.match(labelsPage, /Code non disponible/);
  assert.match(labelsPage, /delivery\.parcelCode \? \(/);
});

test("the label prints TrackFleet id, client, destination and truck, per the product spec's minimum label contents", () => {
  assert.match(labelsPage, /\{delivery\.id\}/);
  assert.match(labelsPage, /\{delivery\.customer\}/);
  assert.match(labelsPage, /→ \{\(delivery\.destinationSiteId && siteCities\.get\(delivery\.destinationSiteId\)\) \|\| delivery\.destination\}/);
  assert.match(labelsPage, /delivery\.truck && <div[^>]*>Camion : \{delivery\.truck\}<\/div>/);
});

test("the dashboard sidebar opens the phone-pairing QR for both dispatcher and agency roles", () => {
  // Now in AppSidebar.tsx, shared between the dashboard and every standalone
  // page (see the 2026-09-02 "sidebar everywhere" request).
  assert.match(appSidebar, /<a className="nav-item" href="\/scan\/connect"><Icon>▦<\/Icon>\{t\.scanTool\}<\/a>/);
  assert.match(i18n, /scanTool: "Scan",/);
  assert.match(i18n, /scanTool: "Scanner",/);
  assert.match(i18n, /scanTool: "Scannen",/);
});

test("a dispatcher can print one delivery's label directly from its table row", () => {
  assert.match(dashboard, /window\.open\(`\/labels\?ids=\$\{delivery\.id\}`, "_blank"\)/);
});

test("bulk label selection lives beside the delivery table filters, opens /labels with every selected id, then clears the selection", () => {
  assert.match(dashboard, /const \[selectedForLabels, setSelectedForLabels\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(dashboard, /className="label-select-checkbox"/);
  assert.match(dashboard, /className="label-print-button"/);
  assert.match(dashboard, /window\.open\(`\/labels\?ids=\$\{Array\.from\(selectedForLabels\)\.join\(","\)\}`, "_blank"\); setSelectedForLabels\(new Set\(\)\);/);
});

test("the delivery table shows both handoff proofs without claiming that the hub scan is final delivery", () => {
  assert.match(dashboard, /Contrôle colis/);
  assert.match(dashboard, /scanSummary\?\.loadedAt/);
  assert.match(dashboard, /scanSummary\?\.hubArrivedAt/);
  assert.match(dashboard, /scanSummary\?\.hubLabel/);
  assert.match(dashboard, /scan-control-cell/);
  assert.match(dashboard, /delivery-identification/);
});

test("the parcel-control column distinguishes labels awaiting print from a print dialog that was actually launched", () => {
  assert.match(dashboard, /labelPrintRequestedAt\?: string \| null/);
  assert.match(dashboard, /Impression lancée/);
  assert.match(dashboard, /À imprimer/);
  assert.match(dashboard, /label-print-status/);
});
