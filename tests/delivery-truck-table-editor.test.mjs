import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("truck assignment moved from the creation form to a per-row editor in the delivery table (dispatcher only)", () => {
  // Picking a truck at creation time was reported as too redundant once
  // several unrelated parcels go out on the same run -- every delivery now
  // starts unassigned (see unassigned-trip-safety.test.mjs) and the truck is
  // picked afterward, directly from the row it belongs to. It shares its
  // popover with the schedule editor (see update-schedule.test.mjs) --
  // status/progress/ETA and truck/date editing were three read-only columns
  // plus two separate edit triggers for the same underlying journey, so
  // they were consolidated into one "Journey" column and one editor.
  assert.match(page, /const \[journeyEditorDeliveryId, setJourneyEditorDeliveryId\] = useState<string \| null>\(null\);/);
  assert.match(page, /const \[truckEditorSelection, setTruckEditorSelection\] = useState\(""\);/);
  assert.match(page, /\{company\?\.role === "dispatcher" && <div className="truck-editor-wrap">/);
  assert.match(page, /\{integration\.connected && integration\.vehicles\.length > 0 && <><strong>\{locale === "fr" \? "Affecter à un camion"/);
});

test("the truck editor calls the (now unguarded) link-vehicle endpoint and updates the delivery in place on success", () => {
  assert.match(page, /async function reassignTruck\(deliveryId: string, vehicleId: string\)/);
  assert.match(page, /fetch\("\/api\/deliveries\/link-vehicle", \{/);
  assert.match(page, /body: JSON\.stringify\(\{ deliveryId, vehicleId \}\)/);
  assert.match(page, /setDeliveries\(\(items\) => items\.map\(\(item\) => item\.id === updated\.id \? updated : item\)\);/);
});

test("the editor warns (without blocking) when the chosen truck already has another active delivery in progress", () => {
  assert.match(page, /const vehicleAssignmentConflict = \(vehicleId: string, excludeDeliveryId: string\) =>\s*\n\s*deliveries\.find\(\(delivery\) => delivery\.id !== excludeDeliveryId && delivery\.sendatrackVehicleId === vehicleId && delivery\.status !== "Delivered"\);/);
  assert.match(page, /\{truckEditorSelection && vehicleAssignmentConflict\(truckEditorSelection, delivery\.id\) && <small className="warning">/);
});

test("clicking inside the popover doesn't close it or bubble up to the row's own click handler", () => {
  // The row itself opens the delivery detail popover on click -- the
  // trigger button and the select each stop propagation individually
  // (a bare onClick-stopPropagation div would trip jsx-a11y rules, as
  // happened earlier this session for the contact popover).
  assert.match(page, /className="more-button journey-editor-trigger" title=\{locale === "fr" \? "Modifier le trajet"/);
  assert.match(page, /event\.stopPropagation\(\); const opening = journeyEditorDeliveryId !== delivery\.id;/);
  assert.match(page, /<select value=\{truckEditorSelection\} disabled=\{truckEditorPending\} onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(page, /<div className="journey-editor-popover truck-editor-popover" onClick=/);
});

test("the popover closes on outside click via the same pattern as the contact popover", () => {
  assert.match(page, /if \(target\?\.closest\("\.journey-editor-popover, \.journey-editor-trigger"\)\) return;\s*\n\s*setJourneyEditorDeliveryId\(null\);/);
});

test("the journey editor popover has its own positioning context and styling", () => {
  assert.match(css, /\.truck-editor-wrap \{ position: relative;/);
  assert.match(css, /\.truck-editor-popover \{ position: absolute;/);
});

test("status, progress and ETA are consolidated into a single Journey column instead of three separate ones", () => {
  assert.match(page, /<th>\{t\.tableJourney\}<\/th><th className="col-actions">/);
  assert.match(page, /<td className="col-journey">\{!group\.uniformDestination && <span className=\{statusClass\[delivery\.status\]\}/);
  assert.doesNotMatch(page, /<th>\{t\.tableStatus\}<\/th>/);
  assert.match(css, /\.col-journey \{ display: flex; align-items: center;/);
});
