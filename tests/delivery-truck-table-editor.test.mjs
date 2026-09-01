import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

// The per-row truck/date-only popover (tested here until this session) was
// replaced by reopening the full creation form pre-filled for edit mode --
// requested live: a dispatcher trying to fix a customer name or destination
// kept finding only truck/date fields, not the rest of the delivery. See
// delivery-edit-mode.test.mjs for the new behavior; this file now only
// checks what's left of the old per-row editor's surface (its CSS, shared
// with the still-live group editors, and the Journey column layout).
test("the per-delivery pencil opens the shared edit form instead of a truck/date-only popover, and is hidden once Delivered", () => {
  assert.match(page, /\{company\?\.role === "dispatcher" && delivery\.status !== "Delivered" && <button type="button" className="more-button journey-editor-trigger" title=\{locale === "fr" \? "Modifier la livraison"/);
  assert.match(page, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openEditModal\(delivery\); \}\}>✎<\/button>/);
  assert.doesNotMatch(page, /journeyEditorDeliveryId/);
  assert.doesNotMatch(page, /async function reassignTruck\(/);
});

test("the journey editor popover CSS (position/anchoring) is still used by the group-level truck and schedule editors", () => {
  assert.match(css, /\.truck-editor-wrap \{ position: relative;/);
  assert.match(css, /\.truck-editor-popover \{ position: absolute;/);
});

// Originally consolidated status/progress/ETA/destination into one Journey
// column (replacing three separate ones); later split back into two --
// Destination and Statut -- once that single column was routinely 2-3 lines
// deep on every row. See table-row-height-overflow-fix.test.mjs for the
// td/div split itself, and delivery-truck-grouping.test.mjs for the Agence
// column being hoisted the same way to make room without widening the table.
test("destination and status/progress/ETA are two columns, not the three separate ones from before the original Journey consolidation", () => {
  assert.match(page, /<th>\{locale === "fr" \? "Destination"/);
  assert.match(page, /<th>\{locale === "fr" \? "Statut"/);
  assert.match(page, /<td className="col-destination">\{!group\.uniformDestination && <span className="journey-destination">/);
  assert.match(page, /<td className="col-status"><div className="col-status-inner"><div className="col-status-top">\{!group\.uniformDestination && <span className=\{statusClass\[delivery\.status\]\}/);
  assert.doesNotMatch(page, /<th>\{t\.tableStatus\}<\/th>/);
  assert.match(css, /\.col-status-inner \{ display: flex; flex-direction: column;/);
});
