import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("arrival/departure dates are edited once per truck group when the group shares one destination, not once per parcel", () => {
  // Reported live: arrival/departure are a property of the truck's run, not
  // of any one parcel on it -- repeating the per-row schedule editor across
  // every parcel of a multi-parcel truck group was the same redundancy the
  // destination/ETA/progress hoisting already solved for those columns,
  // just left over for the two schedule fields. Only offered at the group
  // level when group.uniformDestination is set (a truck relaying to several
  // different destinations still needs each leg's schedule edited on its
  // own row).
  assert.match(page, /const \[groupScheduleEditorLabel, setGroupScheduleEditorLabel\] = useState<string \| null>\(null\);/);
  assert.match(page, /async function updateGroupSchedule\(deliveryIds: string\[\], plannedArrivalAt: string, nextTruckDepartureAt: string\)/);
  assert.match(page, /const results = await Promise\.all\(deliveryIds\.map\(\(deliveryId\) => fetch\("\/api\/deliveries\/update-schedule", \{/);
  assert.match(page, /\{company\?\.role === "dispatcher" && <span className="group-schedule-editor-wrap">/);
  assert.match(page, /onClick=\{\(\) => void updateGroupSchedule\(group\.deliveries\.map\(\(delivery\) => delivery\.id\), groupSchedulePlannedArrival, groupScheduleNextDeparture\)\}/);
});

test("the group schedule editor is nested inside the group.uniformDestination branch, so it never renders for a single parcel or a truck with mixed destinations", () => {
  const start = page.indexOf('{group.uniformDestination && <>');
  const end = page.indexOf('</>}</td></tr>');
  assert.ok(start > -1 && end > start, "expected the uniformDestination JSX block to be found");
  const uniformBlock = page.slice(start, end);
  assert.match(uniformBlock, /group-schedule-editor-trigger/);
});

test("the group schedule popover closes on outside click via the same pattern as the other row popovers", () => {
  assert.match(page, /if \(target\?\.closest\("\.group-schedule-editor-popover, \.group-schedule-editor-trigger"\)\) return;\s*\n\s*setGroupScheduleEditorLabel\(null\);/);
  assert.doesNotMatch(page, /<div className="group-schedule-editor-popover journey-editor-popover truck-editor-popover" onClick=/);
});

test("the per-row journey editor's schedule section is suppressed when the group already offers the shared editor, but the truck-reassignment section still shows", () => {
  assert.match(page, /\{!group\.uniformDestination && <div className="journey-editor-divider" \/>\}<\/>\}\{!group\.uniformDestination && <><strong>\{locale === "fr" \? "Arrivée prévue"/);
});

test("the group schedule popover anchors to the wrapping row, not its own small trigger span", () => {
  // Reported live (for the sibling group-truck-editor-popover, same row,
  // same pattern): .group-header-row td is a wrapping flex container
  // (flex-wrap: wrap), so its rendered height varies with how many lines
  // its content wraps onto. A popover positioned "top: 100%" relative to
  // its own tiny trigger span doesn't account for that -- when the row
  // wrapped to two lines, the popover rendered high enough to overlap the
  // second line instead of clearing the whole row. Anchoring to the td's
  // own box (position: relative, spans every wrapped line) instead of the
  // trigger wrap fixes that regardless of row height.
  assert.match(css, /\.group-header-row td \{ position: relative;/);
  assert.match(css, /\.group-schedule-editor-wrap \{ display: inline-block; \}/);
  assert.doesNotMatch(css, /\.group-schedule-editor-wrap \{ position: relative;/);
});
