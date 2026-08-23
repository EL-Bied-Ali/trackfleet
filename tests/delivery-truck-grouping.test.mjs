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
  assert.match(page, /<tr className="group-header-row"><td colSpan=\{100\}><strong>\{group\.label\}<\/strong><span>\{group\.deliveries\.length\}/);
  // No more per-row <th>/<td> for the vehicle -- that information now lives
  // exactly once, in the group header, instead of once per row.
  assert.doesNotMatch(page, /<th>\{t\.tableVehicle\}<\/th>/);
});

test("the group header row gets its own mobile card-layout treatment instead of being forced into the 2-column grid meant for data rows", () => {
  assert.match(css, /tbody tr\.group-header-row \{ display: block;/);
  assert.match(css, /\.group-header-row td \{ height: auto; padding: 9px 15px; background: #f5f8f6;/);
});
