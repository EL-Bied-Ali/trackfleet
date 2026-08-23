import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const stopPlan = fs.readFileSync(new URL("../app/lib/truck-stop-plan.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("unassigned parcels are excluded from active trip planning", () => {
  assert.match(stopPlan, /!isUnassignedVehicle\(delivery\)/);
  assert.match(stopPlan, /isUnassignedVehicle\(candidate\)/);
});

test("creation UI defaults to assign later and allows offline unassigned parcels", () => {
  // The vehicle select became a controlled input (value/onChange) to drive
  // the truck-availability conflict warning -- see delivery-truck-conflict-warning.test.mjs.
  assert.match(page, /const \[creationVehicleId, setCreationVehicleId\] = useState\(UNASSIGNED_VEHICLE_ID\);/);
  assert.match(page, /select name="sendatrackVehicleId" value=\{creationVehicleId\}/);
  assert.match(page, /Assign later \(recommended\)/);
  assert.doesNotMatch(page, /name="manualTruck" required/);
});
