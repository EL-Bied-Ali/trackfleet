import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const labelsPage = await readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8");

// User asked, after the 12/feuille content-clipping fix shipped: "tu peux
// voir si on peut utiliser plus d'étiquette par page sans casser la
// visibilité" -- specifically requesting a 2 columns x 8 rows (16/feuille)
// layout. The earlier 3x6 (18/feuille) attempt was reverted because text
// wrapped and overflowed at that height; that failure mode no longer
// exists (destination is city-only, every text line truncates instead of
// wrapping -- see label-sheet-reuse.test.mjs), so the only remaining risk
// at 16/feuille's much shorter 37.125mm height is the label's fixed-size
// chrome (padding, QR box, optional logo) eating the available height
// before any text is even drawn.

test("offers the requested 16-per-sheet (2x8) preset", () => {
  assert.match(labelsPage, /\{ cols: 2, rows: 8 \}/);
});

test("still does not offer the reverted 18-per-sheet (3x6) preset", () => {
  assert.doesNotMatch(labelsPage, /\{ cols: 3, rows: 6 \}/);
});

// Padding, QR size and the optional logo's max height were fixed constants
// (4mm / 28mm / 19mm) that fit every preset up to 12/feuille (74.25mm)
// comfortably, but at 16/feuille (37.125mm) they alone would consume most
// of the label's height before a single line of text is drawn. Scaling
// them down with the label's own height keeps the chrome proportional
// instead of clipping the shortest presets -- verified live via a
// scrollHeight/clientHeight DOM measurement reproduction with worst-case
// content (long customer names, a logo present): 0px overflow on both
// 16/feuille and 12/feuille.
test("label padding, QR size and logo max-height scale down with the label's own height instead of staying fixed", () => {
  assert.match(labelsPage, /const labelPaddingMm = Math\.min\(4, Math\.max\(1\.5, labelSize\.height \* 0\.05\)\);/);
  assert.match(labelsPage, /const qrSizeMm = Math\.min\(28, Math\.max\(14, labelSize\.height - 2 \* labelPaddingMm - 5\.5\)\);/);
  assert.match(labelsPage, /const logoMaxHeightMm = Math\.min\(19, labelSize\.height \* 0\.22\);/);
});

test("the label cell actually uses the computed padding/QR/logo sizes, not the old hardcoded 4mm/28mm/19mm", () => {
  assert.match(labelsPage, /padding: `\$\{labelPaddingMm\}mm`/);
  assert.match(labelsPage, /maxHeight: `\$\{logoMaxHeightMm\}mm`/);
  assert.match(labelsPage, /width: `\$\{qrSizeMm\}mm`, height: `\$\{qrSizeMm\}mm`/);
  assert.doesNotMatch(labelsPage, /padding: "4mm"/);
  assert.doesNotMatch(labelsPage, /width: "28mm", height: "28mm"/);
  assert.doesNotMatch(labelsPage, /maxHeight: "19mm"/);
});

// At the label's shortest supported preset (16/feuille, 37.125mm), the
// scaling formulas above should never collapse the QR below a still-
// scannable size, and padding should never grow past the original 4mm
// default even for very tall/manual presets.
// Live-caught after the first version of this feature deployed: MIN_LABEL_MM
// was 40, which is ABOVE the 16/feuille preset's own 37.125mm height.
// clampLabelMm silently pushed the preset's height back up to 40mm the
// moment the button was clicked, landing on 14/feuille (105x40mm, floor(297/40)=7
// rows) instead of the promised 16. Caught via the deployed page itself,
// not local math -- the preset button's own click handler goes through the
// same clamp as the manual mm inputs.
test("MIN_LABEL_MM is low enough that clicking the 16/feuille preset doesn't get silently clamped back up to a shorter height", () => {
  assert.match(labelsPage, /const MIN_LABEL_MM = 35;/);
  const presetHeightAt16PerSheet = Math.floor((297 / 8) * 100) / 100;
  assert.ok(35 <= presetHeightAt16PerSheet, "MIN_LABEL_MM must be at or below the 16/feuille preset's own height");
});

// Live-caught a second time, right after the MIN_LABEL_MM fix deployed:
// with the correct 37.12mm height finally applying, EVERY real label still
// overflowed by a fixed ~20px regardless of its content. Root cause: the
// `qrcode` library's toCanvas() sets the canvas's own style.width/height to
// match its raster size (160px) as part of drawing the QR, silently
// overriding the mm-based CSS size the JSX sets -- so the QR column always
// rendered at its old ~42mm size no matter what qrSizeMm computed. Caught
// via getComputedStyle on the live canvas (160px, not the expected ~106px
// for 27.9mm), not from the earlier synthetic DOM reproduction, which used
// a plain placeholder div instead of a real QRCode.toCanvas() call and so
// never exercised this codepath.
test("the QR canvas's intended mm size is re-asserted after QRCode.toCanvas runs, since the library overwrites the canvas's own style.width/height to match its raster size", () => {
  assert.match(labelsPage, /await QRCode\.toCanvas\(qrCanvas, parcelScanUrl\(origin, delivery\.parcelCode\), \{ width: 160, margin: 1 \}\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*qrCanvas\.style\.width = `\$\{qrSizeMm\}mm`;\s*\n\s*qrCanvas\.style\.height = `\$\{qrSizeMm\}mm`;/);
  assert.match(labelsPage, /\}, \[deliveries, qrSizeMm\]\);/);
});

test("the scaling formulas stay within sane bounds at both the shortest supported preset and the tallest", () => {
  const heightAt16PerSheet = Math.floor((297 / 8) * 100) / 100;
  const paddingAt16 = Math.min(4, Math.max(1.5, heightAt16PerSheet * 0.05));
  const qrAt16 = Math.min(28, Math.max(14, heightAt16PerSheet - 2 * paddingAt16 - 5.5));
  assert.ok(qrAt16 >= 14, "QR must never shrink below a still-scannable 14mm");
  assert.ok(paddingAt16 <= 4 && paddingAt16 >= 1.5, "padding must stay within its clamped range");

  const heightAt1PerSheetHalf = Math.floor((297 / 2) * 100) / 100;
  const paddingAtTall = Math.min(4, Math.max(1.5, heightAt1PerSheetHalf * 0.05));
  const qrAtTall = Math.min(28, Math.max(14, heightAt1PerSheetHalf - 2 * paddingAtTall - 5.5));
  assert.equal(paddingAtTall, 4, "a tall/manual label should still cap at the original 4mm padding");
  assert.equal(qrAtTall, 28, "a tall/manual label should still cap at the original 28mm QR size");
});
