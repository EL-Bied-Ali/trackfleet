import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, css] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

// Reported live via a screenshot: the "Contrôle colis" and "Trajet" columns
// overlapped across row boundaries -- one row's pills/destination bleeding
// visually into the row below it. Root cause was the exact anti-pattern
// this file's own .group-header-row-inner comment already warns about
// (see the "why the flex layout lives on a plain div nested inside the td"
// note above .col-journey-inner in globals.css): .col-journey and
// .scan-control-cell had `display: flex` directly on the <td>, which
// doesn't report wrapped content's real height back to the table's row-
// height calculation the way a genuine table-cell does -- so once a cell's
// flex content wrapped to 2-3 lines (routine for scan-control-cell's three
// pills, or a long destination + relay badge), the extra height just
// overflowed past the row instead of growing it, visually overlapping
// whatever was below. Fix: keep the <td> a real table-cell and move the
// flex layout onto a plain <div> nested inside it, same as the group
// header row's own fix for the identical symptom.
test("neither .col-journey nor .scan-control-cell puts display:flex directly on the <td> -- both push it onto a nested div instead, so wrapped content grows the row instead of overflowing past it", () => {
  assert.doesNotMatch(css, /\.col-journey\s*\{[^}]*display:\s*flex/);
  assert.doesNotMatch(css, /\.scan-control-cell\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.col-journey-inner\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*10px;\s*flex-wrap:\s*wrap;\s*\}/);
  assert.match(css, /\.scan-control-inner\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*5px;\s*flex-wrap:\s*wrap;\s*\}/);
});

test("both col-journey cells (the hoisted group-header one and the per-delivery one) wrap their content in a .col-journey-inner div, not directly in the td", () => {
  assert.match(page, /<td className="col-journey">\{group\.uniformDestination && <div className="col-journey-inner">/);
  assert.match(page, /<td className="col-journey"><div className="col-journey-inner">\{!group\.uniformDestination/);
});

test("the scan-control-cell wraps its three pills in a .scan-control-inner div, not directly in the td", () => {
  assert.match(page, /<td className="scan-control-cell"><div className="scan-control-inner">/);
});
