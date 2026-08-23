import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const stopPlan = fs.readFileSync(new URL("../app/lib/truck-stop-plan.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("unassigned parcels are excluded from active trip planning", () => {
  assert.match(stopPlan, /!isUnassignedVehicle\(delivery\)/);
  assert.match(stopPlan, /isUnassignedVehicle\(candidate\)/);
});

test("creation always starts a delivery unassigned -- truck assignment happens afterward from the table, not at creation", () => {
  // Picking a truck at creation time was too redundant once several
  // unrelated parcels go out on the same run (reported live) -- moved
  // entirely to a per-row editor in the delivery table instead (see
  // delivery-truck-table-editor.test.mjs). The creation form no longer has
  // a vehicle picker at all.
  assert.match(page, /resolveCreationVehicle\(\{ manualTruck: "", selectedVehicleId: "", vehicles: integration\.vehicles \}\)/);
  assert.doesNotMatch(page, /name="sendatrackVehicleId"/);
  assert.doesNotMatch(page, /name="manualTruck"/);
});
