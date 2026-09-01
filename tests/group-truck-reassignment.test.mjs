import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "old-vehicle", trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "sendatrack",
    ...overrides,
  };
}

const newVehicle = { id: "new-vehicle", name: "TR-99", latitude: 33.5, longitude: -7.6, speed: 50, updatedAt: Date.now() };

test("linkVehicleToGroup moves every parcel in the group onto the new vehicle without stripping each other -- the bug a naive per-id loop would hit", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const a = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel A" }));
  const b = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel B" }));
  const c = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel C" }));

  const updated = await memoryStore.linkVehicleToGroup([a.id, b.id, c.id], companyId, newVehicle);
  assert.equal(updated.length, 3);
  assert.ok(updated.every((delivery) => delivery.sendatrackVehicleId === "new-vehicle"));

  // The real regression this guards: a naive "call linkVehicle once per id"
  // loop would have each call unassign the vehicle from the delivery(ies)
  // the previous call in the same batch just assigned it to, since
  // linkVehicle's own safety guard only excludes the single id it was
  // called with.
  const all = await memoryStore.listForCompany(companyId);
  assert.equal(all.filter((delivery) => delivery.sendatrackVehicleId === "new-vehicle").length, 3);
});

// Same analogous bug as the single-delivery linkVehicle fix (see
// vehicle-single-assignment.test.mjs) -- confirmed live here too:
// reassigning a group onto a truck that already carries its own parcels
// silently kicked those existing parcels back to unassigned, with their
// last GPS position/status still attached (a ghost truck on the map).
// linkVehicleToGroup must join the target truck's existing parcels, not
// evict them, same as linkVehicle now does.
test("linkVehicleToGroup joins an unrelated delivery already on the target truck instead of evicting it", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const outsider = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Outsider", sendatrackVehicleId: "new-vehicle" }));
  const a = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel A" }));

  await memoryStore.linkVehicleToGroup([a.id], companyId, newVehicle);

  const all = await memoryStore.listForCompany(companyId);
  const outsiderAfter = all.find((delivery) => delivery.id === outsider.id);
  assert.equal(outsiderAfter?.sendatrackVehicleId, "new-vehicle", "the outsider was already correctly on this truck and must not be evicted by the group reassignment");
});

test("linkVehicleToGroup skips a Delivered parcel in the requested group, returning only the ones actually updated", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const active = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Active" }));
  const delivered = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Delivered", status: "Delivered" }));

  const updated = await memoryStore.linkVehicleToGroup([active.id, delivered.id], companyId, newVehicle);
  assert.deepEqual(updated.map((delivery) => delivery.id).sort(), [active.id]);
});

const [page, css, linkVehicleRoute] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/link-vehicle/route.ts", import.meta.url), "utf8"),
]);

test("the link-vehicle route does the whole group as one atomic call, not a loop of the single-id path", () => {
  assert.match(linkVehicleRoute, /const bulk = Array\.isArray\(payload\.deliveryIds\);/);
  assert.match(linkVehicleRoute, /store\.linkVehicleToGroup\(deliveryIds, session\.companyId, vehicle\)/);
});

test("the group truck-reassignment control is dispatcher-only and hidden for the unassigned pseudo-group", () => {
  assert.match(page, /const \[groupTruckEditorLabel, setGroupTruckEditorLabel\] = useState<string \| null>\(null\);/);
  assert.match(page, /reassignTruckForGroup\(group\.deliveries\.map\(\(delivery\) => delivery\.id\), groupTruckEditorSelection\)/);
  assert.match(page, /company\?\.role === "dispatcher" && group\.label !== \(locale === "fr" \? "À affecter"/);
});

test("group truck reassignment popover no longer needs a left-anchor override -- its trigger now sits in the same col-actions cell as the schedule editor's, not near the start of the row", () => {
  // Originally this trigger sat near the left of one giant flex row spanning
  // every column (colSpan={100}), so the base .truck-editor-popover's
  // right:0 default (correct for the far-right schedule-editor trigger)
  // expanded it leftward off the edge of the table. Reported live, fixed
  // with a left:0 override at the time.
  //
  // The group header row was later split into real per-column cells (see
  // the width-fix test below) so it lines up with the columns underneath
  // it, and both edit triggers moved together into their own col-actions
  // cell -- the same cell the per-row journey editor already uses. Both
  // now anchor correctly off the base right:0 default, so the override is
  // gone entirely rather than swapped to match.
  assert.doesNotMatch(css, /\.group-truck-editor-popover \{ left: 0; right: auto; \}/);
  assert.match(page, /<td className="col-actions"><div className="group-header-row-inner">\{company\?\.role === "dispatcher" && group\.label !== \(locale === "fr" \? "À affecter"/);
});

test("group truck reassignment popover anchors to the wrapping row, not its own small trigger span", () => {
  // Reported live: the group header's flex content is a wrapping container
  // (flex-wrap: wrap), so its rendered height varies with how many lines it
  // wraps onto. A popover positioned "top: 100%" relative to its own tiny
  // trigger span doesn't account for that.
  //
  // Two earlier fixes here both measured as still broken when actually
  // tested live via getBoundingClientRect (see the next test) --
  // .group-header-row-inner (a plain <div> nested inside the still-native
  // table-cell td, not the td itself) is what carries position: relative
  // now.
  assert.match(css, /\.group-header-row-inner \{ position: relative;/);
  assert.match(css, /\.group-truck-editor-wrap \{ display: inline-block; \}/);
  assert.doesNotMatch(css, /\.group-truck-editor-wrap \{ position: relative;/);
});

test("the truck picker shows each vehicle's \"Camion N\" number alongside its plate, matching the badges used everywhere else", () => {
  // Reported live: the dropdown listed bare plate numbers with no way to
  // tell which colored/numbered badge (seen on the map, the fleet roster,
  // the group header) each one corresponds to.
  assert.match(page, /\{integration\.vehicles\.map\(\(vehicle\) => <option key=\{vehicle\.id\} value=\{vehicle\.id\}>\{truckNumberLabel\(vehicle\.id\) \? `\$\{truckNumberLabel\(vehicle\.id\)\} · \$\{vehicle\.name\}` : vehicle\.name\}<\/option>\)\}/g);
  const occurrences = page.match(/truckNumberLabel\(vehicle\.id\) \? `\$\{truckNumberLabel\(vehicle\.id\)\} · \$\{vehicle\.name\}` : vehicle\.name/g) ?? [];
  assert.equal(occurrences.length, 3, "expected all 3 truck pickers (group reassignment, vehicle-link popover, the shared delivery creation/edit form) to show the truck number");
});

test("the group header row stretches to fill its full row width, not just its content -- reported live three times as a jarring blank white gap before this held up under actual measurement", () => {
  // Attempt 1 (width: 100% on the td alone) and attempt 2 (display: block
  // on the whole <tr>, matching the mobile media query) were both reported
  // still broken. Verified why by loading a browser and measuring with
  // getBoundingClientRect before landing attempt 3: switching the <tr>/<td>
  // to a non-table display value pulls them out of the table's real
  // column-width algorithm (colSpan={100} only spans columns for a td
  // that's still display: table-cell) -- and a block-level element whose
  // ancestor chain still runs through display:table/table-row-group
  // doesn't reliably resolve percentage widths against the table's actual
  // pixel width either, even with an explicit width: 100%. Confirmed with
  // real numbers, not just code-reading, both broken (td measured at
  // roughly half the table's real width) and this fix correct (measured
  // pixel-exact against the table width): leave the <tr>/<td> as real
  // table-row/table-cell -- letting colSpan do what it's designed for --
  // and put the flex layout on a plain <div> nested inside the td instead.
  assert.doesNotMatch(css, /\.group-header-row \{ display: block; \}/);
  assert.match(css, /\.group-header-row td \{ padding: 9px 15px; background: #f5f8f6; border-bottom: 1px solid var\(--line\); cursor: default; \}/);
  assert.match(css, /\.group-header-row-inner \{ position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; \}/);
  assert.match(page, /<td colSpan=\{company\?\.role === "dispatcher" \? 4 : 3\}><div className="group-header-row-inner">/);
  assert.match(page, /<\/div>\}<\/td><td className="col-actions"><div className="group-header-row-inner">.*<\/div><\/td><\/tr>/s);
});

test("the group header row lines up with the columns below it instead of one flex row crammed across the whole width -- reported live as misaligned, cluttered, and inconsistent with the data rows underneath", () => {
  // Fixing the width bug (above) made the row fill the table correctly, but
  // it was still a single td colSpan-ing every column with all its content
  // (truck info, hoisted status/destination/ETA/progress, both edit
  // triggers) crammed into one flex line -- reported live as not lining up
  // with LIVRAISON/CLIENT/AGENCE/TRAJET below it, and feeling cluttered.
  // Split into 3 real cells matching the table's own columns instead: truck
  // info spans LIVRAISON/CLIENT/[AGENCE], hoisted journey info gets its own
  // col-journey cell (reusing the exact class the per-row journey cell
  // already uses), and both edit triggers share a col-actions cell (same
  // pattern the per-row journey-editor trigger already uses).
  assert.match(page, /<td className="col-journey">\{group\.uniformDestination && <div className="col-journey-inner">/);
  assert.match(css, /\.col-journey-inner \{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; \}/);
});

test("the two group header action triggers stay on one line even when the col-journey cell wraps to two -- reported live as the truck and schedule icons stacking vertically on a long destination address", () => {
  // .group-header-row-inner's flex-wrap: wrap is needed for the LIVRAISON
  // cell (the truck badge/plate/count can genuinely overflow a narrow
  // column), but the same class is reused for the col-actions cell's inner
  // div. With wrap allowed there too, the table's auto layout sized the
  // much narrower actions cell down to fit just one icon, so a second
  // (independent) trigger wrapped onto its own line whenever the row grew
  // taller from the col-journey cell wrapping -- even though the actions
  // cell had plenty of horizontal room for both if wrapping weren't an
  // option. Forcing nowrap just on this cell's inner div keeps both
  // triggers side by side regardless of the row's own height.
  assert.match(css, /\.group-header-row td\.col-actions \.group-header-row-inner \{ flex-wrap: nowrap; \}/);
});
