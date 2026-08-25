import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("each vehicle gets a stable, friendly 'Truck N' tag shown alongside its real plate, not replacing it", () => {
  // This is purely a friendlier way to refer to a vehicle -- the plate
  // stays the actual display name/identifier everywhere, this is additive.
  assert.match(page, /const \[vehicleTruckNumbers, setVehicleTruckNumbers\] = useState<Map<string, number>>\(new Map\(\)\);/);
  assert.match(page, /const truckNumberLabel = useCallback\(\(vehicleId\?: string \| null\) => \{/);
  assert.match(page, /if \(!number\) return null;/);
});

test("a vehicle's truck number is assigned once and never reassigned or shifted, even if it temporarily drops out of SENDATRACK's live feed", () => {
  // Reported live: numbering used to be recomputed fresh from whichever
  // vehicle ids happened to be in the CURRENT poll (sorted-index based), so
  // one vehicle briefly missing a GPS fix shifted every subsequent
  // vehicle's number down -- a different truck would suddenly show the
  // same "Camion N" badge (and color, since that's derived from the
  // number) another truck had a moment earlier. Assignments now accumulate
  // in state (updated from an effect, not during render -- React refs/state
  // must not be mutated while rendering) keyed by vehicle id and are only
  // ever added to, never mutated or reassigned.
  assert.match(page, /setVehicleTruckNumbers\(\(current\) => \{/);
  assert.match(page, /\.filter\(\(id\) => !current\.has\(id\)\)/);
  assert.match(page, /next\.set\(id, nextNumber\);/);
  assert.match(page, /if \(newIds\.length === 0\) return current;/);
  assert.doesNotMatch(page, /sorted\.map\(\(vehicle, index\) => \[vehicle\.id, index \+ 1\]\)/);
});

test("the truck number appears as the same colored badge everywhere it's shown: the fleet roster, the delivery table's truck-group headers, and the truck popover", () => {
  // Regression guard: the badge originally reused the "truck-badge" class
  // name already used for the popover's fixed 30x30 icon slot, which forced
  // the new text badge into that same fixed square and clipped "Camion N"
  // down to a few pixels -- reported live ("the label for camion is a bit
  // off"). Renamed to "truck-number-badge" so it sizes to its own content,
  // and applied consistently wherever "Camion N" text is written, not just
  // in the table.
  assert.doesNotMatch(page, /truckLabelWithNumber/);
  assert.match(page, /truckNumberLabel\(vehicle\.id\) && <b className="truck-number-badge"/);
  assert.match(page, /truckNumberLabel\(selected\.sendatrackVehicleId\) && <b className="truck-number-badge"/);
  assert.match(page, /numberLabel: truckNumberLabel\(delivery\.sendatrackVehicleId\),/);
  assert.match(css, /\.truck-number-badge \{ display: inline-block;/);
  assert.doesNotMatch(css, /\.group-header-row \.truck-badge \{/);
});

test("the map marker itself shows the truck number instead of the generic icon, falling back to the icon when no number is known", () => {
  const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
  // Flag emoji rendered as blank/tofu on Windows in an earlier fix (see the
  // comment above originCountryLabel) -- plain digits don't have that
  // problem, so this is safe where an emoji badge wasn't.
  assert.match(map, /truckNumber\?: number \| null;/);
  assert.match(map, /<span aria-hidden="true">\$\{delivery\.truckNumber \?\? "▰"\}<\/span>/);
  assert.match(map, /<span aria-hidden="true">\$\{vehicle\.truckNumber \?\? "▰"\}<\/span>/);
  assert.match(page, /const truckNumber = delivery\.sendatrackVehicleId \? vehicleTruckNumbers\.get\(delivery\.sendatrackVehicleId\) \?\? null : null;/);
  assert.match(page, /const truckNumber = vehicleTruckNumbers\.get\(vehicle\.id\) \?\? null;/);
  assert.match(page, /liveVehicles=\{liveVehiclesWithNumbers\}/);
});
