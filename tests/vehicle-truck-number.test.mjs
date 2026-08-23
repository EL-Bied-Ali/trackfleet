import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("each vehicle gets a stable, friendly 'Truck N' tag shown alongside its real plate, not replacing it", () => {
  // Numbered by sorting SENDATRACK's own vehicle ids (stable per physical
  // vehicle), so the same truck keeps the same number across reloads as
  // long as the fleet's vehicle set doesn't change. This is purely a
  // friendlier way to refer to a vehicle -- the plate stays the actual
  // display name/identifier everywhere, this is additive.
  assert.match(page, /const vehicleTruckNumbers = useMemo\(\(\) => \{/);
  assert.match(page, /sorted\.map\(\(vehicle, index\) => \[vehicle\.id, index \+ 1\]\)/);
  assert.match(page, /const truckLabelWithNumber = useCallback\(\(name: string, vehicleId\?: string \| null\) => \{/);
  assert.match(page, /if \(!number\) return name;/);
});

test("the truck number tag appears in the fleet roster, the delivery table's truck-group headers, and the truck popover", () => {
  assert.match(page, /truckLabelWithNumber\(vehicle\.name, vehicle\.id\)/);
  assert.match(page, /label: unassigned \? unassignedLabel : truckLabelWithNumber\(delivery\.truck, delivery\.sendatrackVehicleId\)/);
  assert.match(page, /truckLabelWithNumber\(vehicleLabel\(selected\), selected\.sendatrackVehicleId\)/);
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
