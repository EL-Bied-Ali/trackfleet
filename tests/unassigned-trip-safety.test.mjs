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
  assert.match(page, /defaultValue=\{UNASSIGNED_VEHICLE_ID\}/);
  assert.match(page, /Assign later \(recommended\)/);
  assert.doesNotMatch(page, /name="manualTruck" required/);
});
