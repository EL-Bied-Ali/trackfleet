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
  assert.equal(occurrences.length, 8, "expected all 8 optional-field labels to use the badge span");
  assert.match(css, /\.optional-badge \{ display: inline-block; margin-left: 5px; padding: 1px 7px; border-radius: 999px; background: #eef1ee; color: #8a8087; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: \.3px; vertical-align: middle; \}/);
});
