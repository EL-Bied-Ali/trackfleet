import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("each vehicle gets a stable, friendly 'Truck N' tag shown alongside its real plate, not replacing it", () => {
  // Numbered by sorting SENDATRACK's own vehicle ids (stable per physical
  // vehicle), so the same truck keeps the same number across reloads as
  // long as the fleet's vehicle set doesn't change. This is purely a
  // friendlier way to refer to a vehicle -- the plate stays the actual
  // display name/identifier everywhere, this is additive.
  assert.match(page, /const vehicleTruckNumbers = useMemo\(\(\) => \{/);
  assert.match(page, /sorted\.map\(\(vehicle, index\) => \[vehicle\.id, index \+ 1\]\)/);
  assert.match(page, /const truckNumberLabel = useCallback\(\(vehicleId\?: string \| null\) => \{/);
  assert.match(page, /if \(!number\) return null;/);
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
  assert.match(page, /truckNumber: delivery\.sendatrackVehicleId \? vehicleTruckNumbers\.get\(delivery\.sendatrackVehicleId\) \?\? null : null,/);
  assert.match(page, /const liveVehiclesWithNumbers = integration\.vehicles\.map\(\(vehicle\) => \(\{ \.\.\.vehicle, truckNumber: vehicleTruckNumbers\.get\(vehicle\.id\) \?\? null \}\)\);/);
  assert.match(page, /liveVehicles=\{liveVehiclesWithNumbers\}/);
});
