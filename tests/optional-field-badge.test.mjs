import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, css] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

// Live feedback: "(facultatif)" as plain parenthesized text next to a label
// requires actually reading it -- not ideal for a fast-moving, not-heavily-
// trained depot employee who should recognize an optional field at a
// glance. Every occurrence now renders inside a distinct shape/color
// badge instead of bare parenthesized text.
test("every optional-field marker renders as a distinct badge (shape + color), not plain parenthesized text", () => {
  assert.doesNotMatch(page, /<span>\(\{t\.optional\}\)<\/span>/);
  const occurrences = [...page.matchAll(/<span className="optional-badge">\{t\.optional\}<\/span>/g)];
  // 7, not the original 8 -- live feedback caught "Camion" wrongly labeled
  // optional (the client's own workflow always assigns a truck; the field
  // stays skippable in code -- "assign later" -- but no longer says so).
  assert.equal(occurrences.length, 7, "expected 7 optional-field labels to use the badge span");
  assert.match(css, /\.optional-badge \{ display: inline-block; margin-left: 5px; padding: 1px 7px; border-radius: 999px; background: #eef1ee; color: #8a8087; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: \.3px; vertical-align: middle; \}/);
});

test("the truck field no longer claims to be optional -- it stays functionally skippable (\"assign later\") but the label doesn't say so", () => {
  assert.match(page, /<label><span className="field-label">\{locale === "fr" \? "Camion" : locale === "nl" \? "Vrachtwagen" : "Truck"\}<\/span><select value=\{creationVehicleId\}/);
});

test("every new light-styled element added alongside the badge/parcel-row work has a dark-mode override -- a live screenshot caught unstyled ones rendering as a blinding white card against the rest of the dark-mode form", () => {
  assert.match(css, /:root\[data-theme="dark"\] \.form-section, :root\[data-theme="dark"\] \.site-manager-card, :root\[data-theme="dark"\] \.expected-parcel-card, :root\[data-theme="dark"\] \.tour-card, :root\[data-theme="dark"\] \.tour-stop, :root\[data-theme="dark"\] \.price-preview, :root\[data-theme="dark"\] \.parcel-row \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.remove-parcel-row \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.grouped-weight-note \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.optional-badge \{/);
});
