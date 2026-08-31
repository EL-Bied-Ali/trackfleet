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

test("status, progress and ETA are consolidated into a single Journey column instead of three separate ones", () => {
  assert.match(page, /<th>\{t\.tableJourney\}<\/th><th className="col-actions">/);
  assert.match(page, /<td className="col-journey">\{!group\.uniformDestination && <span className="journey-destination">.*?\}<\/span>\}\{!group\.uniformDestination && <span className=\{statusClass\[delivery\.status\]\}/);
  assert.doesNotMatch(page, /<th>\{t\.tableStatus\}<\/th>/);
  assert.match(css, /\.col-journey \{ display: flex; align-items: center;/);
});
