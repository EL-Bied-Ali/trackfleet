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
  assert.match(page, /const truckLabelWithNumber = \(name: string, vehicleId\?: string \| null\) => \{/);
  assert.match(page, /if \(!number\) return name;/);
});

test("the truck number tag appears in the fleet roster, the delivery table's vehicle column, and the truck popover", () => {
  assert.match(page, /truckLabelWithNumber\(vehicle\.name, vehicle\.id\)/);
  assert.match(page, /truckLabelWithNumber\(vehicleLabel\(delivery\), delivery\.sendatrackVehicleId\)/);
  assert.match(page, /truckLabelWithNumber\(vehicleLabel\(selected\), selected\.sendatrackVehicleId\)/);
});
