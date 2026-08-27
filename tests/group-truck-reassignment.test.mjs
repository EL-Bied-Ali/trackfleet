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

test("linkVehicleToGroup unassigns the vehicle from an unrelated delivery outside the group, same safety guard as the single-id path", async () => {
  const companyId = `group-truck-test-${Date.now()}-${Math.random()}`;
  const outsider = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Outsider", sendatrackVehicleId: "new-vehicle" }));
  const a = await memoryStore.create(baseDeliveryInput({ companyId, customer: "Parcel A" }));

  await memoryStore.linkVehicleToGroup([a.id], companyId, newVehicle);

  const all = await memoryStore.listForCompany(companyId);
  const outsiderAfter = all.find((delivery) => delivery.id === outsider.id);
  assert.equal(outsiderAfter?.sendatrackVehicleId, "");
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

test("group truck reassignment popover anchors left, not right -- its trigger sits near the left of the header row, unlike the schedule editor's trigger far to the right", () => {
  // Reported live: with the base .truck-editor-popover's right:0 default
  // (correct for the far-right schedule-editor trigger), this popover
  // expanded leftward off the edge of the table since its own trigger sits
  // near the start of the row.
  assert.match(css, /\.group-truck-editor-popover \{ left: 0; right: auto; \}/);
});

test("group truck reassignment popover anchors to the wrapping row, not its own small trigger span", () => {
  // Reported live: .group-header-row td is a wrapping flex container
  // (flex-wrap: wrap), so its rendered height varies with how many lines
  // its content wraps onto. A popover positioned "top: 100%" relative to
  // its own tiny trigger span doesn't account for that -- when the row
  // wrapped to two lines, the popover rendered high enough to overlap the
  // second line's badges/destination instead of clearing the whole row.
  // Anchoring to the td's own box (position: relative, spans every wrapped
  // line) instead of the trigger wrap fixes that regardless of row height.
  assert.match(css, /\.group-header-row td \{ position: relative;/);
  assert.match(css, /\.group-truck-editor-wrap \{ display: inline-block; \}/);
  assert.doesNotMatch(css, /\.group-truck-editor-wrap \{ position: relative;/);
});

test("the truck picker shows each vehicle's \"Camion N\" number alongside its plate, matching the badges used everywhere else", () => {
  // Reported live: the dropdown listed bare plate numbers with no way to
  // tell which colored/numbered badge (seen on the map, the fleet roster,
  // the group header) each one corresponds to.
  assert.match(page, /\{integration\.vehicles\.map\(\(vehicle\) => <option key=\{vehicle\.id\} value=\{vehicle\.id\}>\{truckNumberLabel\(vehicle\.id\) \? `\$\{truckNumberLabel\(vehicle\.id\)\} · \$\{vehicle\.name\}` : vehicle\.name\}<\/option>\)\}/g);
  const occurrences = page.match(/truckNumberLabel\(vehicle\.id\) \? `\$\{truckNumberLabel\(vehicle\.id\)\} · \$\{vehicle\.name\}` : vehicle\.name/g) ?? [];
  assert.equal(occurrences.length, 3, "expected all 3 truck pickers (group reassignment, per-delivery reassignment, vehicle-link popover) to show the truck number");
});

test("the group header row stretches to fill its full row width, not just its content -- reported live twice as a jarring blank white gap", () => {
  // First fix attempt (width: 100% on the td alone) was reported still
  // broken. The real mechanism: a <tr> requires its children to be
  // table-cell boxes; once this td's display changes to flex, it stops
  // generating one, colSpan becomes meaningless, and the browser wraps it
  // in an anonymous cell that only ever occupies column 1 of the table's
  // shared column grid -- no width value on the td can make it span the
  // other columns (CLIENT/AGENCE/TRAJET), since that's a table-structure
  // concept, not a sizing one. Taking the whole <tr> out of table layout
  // (matching what the mobile media query below already does, proven
  // correct there) sidesteps the column grid entirely instead of fighting
  // it with another width guess.
  assert.match(css, /\.group-header-row \{ display: block; \}/);
  assert.match(css, /\.group-header-row td \{ position: relative; width: 100%;.*display: flex;.*box-sizing: border-box; \}/);
});
