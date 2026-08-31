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
  assert.match(page, /\{group\.uniformDestination && company\?\.role === "dispatcher" && <span className="group-schedule-editor-wrap">/);
  assert.match(page, /onClick=\{\(\) => void updateGroupSchedule\(group\.deliveries\.map\(\(delivery\) => delivery\.id\), "", groupScheduleNextDeparture\)\}/);
});

test("the group schedule editor is nested inside the group.uniformDestination branch, so it never renders for a single parcel or a truck with mixed destinations", () => {
  // The schedule editor now lives in its own col-actions cell (moved there
  // so the group header row lines up with the columns below it -- see the
  // col-journey/col-actions split below), not inside the same <>...</>
  // fragment as the hoisted status/destination/ETA/progress anymore. It's
  // still gated on group.uniformDestination directly, just as its own
  // conditional expression rather than nested in that fragment.
  const start = page.indexOf('<tr className="group-header-row">');
  const end = page.indexOf('</tr>', start);
  assert.ok(start > -1 && end > start, "expected the group header row to be found");
  const row = page.slice(start, end);
  assert.match(row, /\{group\.uniformDestination && company\?\.role === "dispatcher" && <span className="group-schedule-editor-wrap">.*group-schedule-editor-trigger/s);
});

test("the group schedule popover closes on outside click via the same pattern as the other row popovers", () => {
  assert.match(page, /if \(target\?\.closest\("\.group-schedule-editor-popover, \.group-schedule-editor-trigger"\)\) return;\s*\n\s*setGroupScheduleEditorLabel\(null\);/);
  assert.doesNotMatch(page, /<div className="group-schedule-editor-popover journey-editor-popover truck-editor-popover" onClick=/);
});

test("the group schedule popover anchors to the wrapping row, not its own small trigger span", () => {
  // Reported live (for the sibling group-truck-editor-popover, same row,
  // same pattern): the group header's flex content is a wrapping container
  // (flex-wrap: wrap), so its rendered height varies with how many lines it
  // wraps onto. A popover positioned "top: 100%" relative to its own tiny
  // trigger span doesn't account for that -- when the row wrapped to two
  // lines, the popover rendered high enough to overlap the second line
  // instead of clearing the whole row.
  //
  // Two earlier fixes here (width:100% on the td, then display:block on the
  // <tr>) both measured as still broken when actually tested live via
  // getBoundingClientRect -- switching the <tr>/<td> away from
  // display:table-row/table-cell breaks colSpan's native column-spanning
  // and doesn't reliably resolve percentage widths either. The td/tr stay
  // real table elements; the flex layout (and this position: relative
  // anchor) live on a plain .group-header-row-inner <div> nested inside the
  // td instead, which measured correctly. The schedule editor's trigger now
  // sits in its own col-actions cell (same cell the truck-editor trigger
  // moved into, matching the per-row action column), each with its own
  // .group-header-row-inner anchor scoped to just that cell.
  assert.match(css, /\.group-header-row-inner \{ position: relative;/);
  assert.match(page, /<td className="col-actions"><div className="group-header-row-inner">/);
  assert.match(css, /\.group-schedule-editor-wrap \{ display: inline-block; \}/);
  assert.doesNotMatch(css, /\.group-schedule-editor-wrap \{ position: relative;/);
});
