import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("the delivery table groups rows by truck instead of repeating the vehicle on every row", () => {
  // A delivery and its truck go together -- repeating the vehicle name on
  // every single row (like the departure-date label did) was noise. This
  // groups by sendatrackVehicleId when the truck is a tracked SENDATRACK
  // vehicle, falling back to the manually-entered truck name so untracked
  // trucks still group consistently by name.
  assert.match(page, /const groupedDeliveries = useMemo\(\(\) => \{/);
  assert.match(page, /const key = unassigned \? "__unassigned__" : \(delivery\.sendatrackVehicleId \|\| delivery\.truck\);/);
});

test("unassigned parcels collect into their own trailing group instead of scattering through numbered truck groups", () => {
  assert.match(page, /const unassignedLabel = locale === "fr" \? "À affecter"/);
  assert.match(page, /sortKey: unassigned \? Number\.MAX_SAFE_INTEGER : \(truckNumber \?\? Number\.MAX_SAFE_INTEGER - 1\)/);
  assert.match(page, /\.sort\(\(a, b\) => a\.sortKey - b\.sortKey \|\| a\.label\.localeCompare\(b\.label\)\)/);
});

test("each group renders as its own tbody with a header row showing the truck and parcel count, and the vehicle column is gone from data rows (redundant with the header)", () => {
  assert.match(page, /\{groupedDeliveries\.map\(\(group\) => <tbody key=\{group\.label\}>/);
  assert.match(page, /<tr className="group-header-row"><td colSpan=\{100\}><div className="group-header-row-inner">\{group\.numberLabel && <span className="truck-number-badge"[^>]*>\{group\.numberLabel\}<\/span>\}<strong>\{group\.label\}<\/strong><span>\{group\.deliveries\.length\}/);
  // No more per-row <th>/<td> for the vehicle -- that information now lives
  // exactly once, in the group header, instead of once per row.
  assert.doesNotMatch(page, /<th>\{t\.tableVehicle\}<\/th>/);
});

test("the truck number gets its own colored badge in the group header, a different color per truck, instead of the plain text it used to be", () => {
  // The little colored avatar previously on the Client cell was removed
  // (every real delivery got the same default color there, so it wasn't
  // actually distinguishing anything) -- reused for the truck number
  // instead, where a distinct color per truck is actually useful. Untracked
  // trucks and the unassigned group have no number, so they get no badge.
  assert.match(page, /const truckBadgeColors = \[/);
  assert.match(page, /function truckBadgeColor\(number: number \| null\) \{/);
  assert.match(page, /truckNumber,\s*\n\s*numberLabel: truckNumberLabel\(delivery\.sendatrackVehicleId\),/);
  assert.match(page, /style=\{\{ background: truckBadgeColor\(group\.truckNumber\) \}\}/);
  assert.match(css, /\.group-header-row span\.truck-number-badge \{ color: white; \}/);
});

test("the client cell no longer shows the little colored initials avatar", () => {
  assert.doesNotMatch(page, /delivery\.customer\.split\(" "\)\.map\(\(word\) => word\[0\]\)/);
  assert.doesNotMatch(css, /\.customer-cell i \{/);
});

test("the group header row gets its own mobile card-layout treatment instead of being forced into the 2-column grid meant for data rows", () => {
  assert.match(css, /tbody tr\.group-header-row \{ display: block;/);
  assert.match(css, /\.group-header-row td \{ padding: 9px 15px; background: #f5f8f6;/);
});

test("status/destination/ETA/progress are hoisted into the group header only when a truck has more than one parcel and they all share the same destination AND status", () => {
  // Departure/arrival/status depend on the truck, not the individual parcel
  // -- when a truck's whole group is headed to one destination, repeating
  // that status/destination/ETA/progress on every row is the same
  // duplication the old vehicle column had. A truck relaying parcels to
  // several destinations keeps those columns per row since they're
  // genuinely different there. A lone parcel has nothing to deduplicate
  // against, so it must NOT hoist -- doing so just adds a header row for no
  // space savings and hides the arrival/progress info from the only row
  // that has it (reported live: single-parcel groups were spanning two
  // lines with the data pulled up into an otherwise-empty-feeling header).
  // Status is checked too (not just destination), reported live as still
  // feeling redundant/confusing once destination/ETA/progress already
  // hoisted but status kept repeating -- and status must genuinely match
  // too, since a dispatcher can manually complete one parcel of a group
  // ahead of its truck-mates, at which point hoisting one shared status
  // would misrepresent the other.
  assert.match(page, /const firstDestination = group\.deliveries\[0\]\?\.destination \|\| null;/);
  assert.match(page, /const firstStatus = group\.deliveries\[0\]\?\.status \?\? null;/);
  assert.match(page, /const uniformDestination = group\.deliveries\.length > 1\s*\n\s*&& firstDestination\s*\n\s*&& group\.deliveries\.every\(\(delivery\) => delivery\.destination === firstDestination && delivery\.status === firstStatus\)\s*\n\s*\? group\.deliveries\[0\]\s*\n\s*: null;/);
  assert.match(page, /return \{ \.\.\.group, uniformDestination \};/);
});

test("the group header shows the hoisted status/destination/ETA/progress, and per-row cells go fully blank instead of repeating any of it", () => {
  assert.match(page, /\{group\.uniformDestination && <>/);
  assert.match(page, /<span className=\{statusClass\[group\.uniformDestination\.status\]\}><i \/>\{t\.statuses\[group\.uniformDestination\.status\]\}<\/span>/);
  assert.match(page, /<span className="group-header-destination">\{group\.uniformDestination\.destination\}<\/span>/);
  assert.match(page, /<span className="group-header-progress"><div className="progress">/);
  assert.match(page, /\{!group\.uniformDestination && <span className=\{statusClass\[delivery\.status\]\}>/);
  assert.match(page, /\{!group\.uniformDestination && <div className="progress">/);
  assert.match(page, /\{group\.uniformDestination \? <span className="cell-hoisted">—<\/span> : <span className="journey-eta"><strong>/);
});

test("the hoisted header pieces and blanked cells have their own CSS instead of relying on the base group-header text style", () => {
  assert.match(css, /\.group-header-row span\.group-header-destination \{/);
  assert.match(css, /\.group-header-progress \{/);
  assert.match(css, /\.cell-hoisted \{/);
});
