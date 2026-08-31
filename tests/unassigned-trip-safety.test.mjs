import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const stopPlan = fs.readFileSync(new URL("../app/lib/truck-stop-plan.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("unassigned parcels are excluded from active trip planning", () => {
  assert.match(stopPlan, /!isUnassignedVehicle\(delivery\)/);
  assert.match(stopPlan, /isUnassignedVehicle\(candidate\)/);
});

test("creation lets the dispatcher pick a truck up front, defaulting to unassigned when nothing is chosen", () => {
  // Picking a truck at creation time was originally removed as too redundant
  // once several unrelated parcels go out on the same run -- moved entirely
  // to a per-row editor in the delivery table instead. Brought back by
  // request (truck reassignment from the table works fine, it should just
  // also be possible from the creation form) -- unlike before, a delivery
  // still defaults to unassigned when the dispatcher leaves the picker on
  // "assign later" or isn't a dispatcher/has no connected fleet at all.
  assert.match(page, /resolveCreationVehicle\(\{ manualTruck: "", selectedVehicleId: creationVehicleId, vehicles: integration\.vehicles \}\)/);
  assert.doesNotMatch(page, /name="sendatrackVehicleId"/);
  assert.doesNotMatch(page, /name="manualTruck"/);
});

test("the creation truck picker remembers the last truck chosen, per dispatcher user, and re-validates it's still connected each time the modal opens", () => {
  assert.match(page, /import \{ truckPreferenceKey, resolvePreferredTruck \} from "\.\/lib\/truck-preference";/);
  assert.match(page, /function openCreateModal\(\) \{/);
  assert.match(page, /resolvePreferredTruck\(window\.localStorage\.getItem\(truckPreferenceKey\(company\)\), integration\.vehicles\.map\(\(vehicle\) => vehicle\.id\)\)/);
  assert.match(page, /if \(company\) window\.localStorage\.setItem\(truckPreferenceKey\(company\), vehicleChoice\.sendatrackVehicleId\);/);
});

test("the creation truck picker is dispatcher-only and hidden when no fleet is connected, matching the table's own truck editors", () => {
  assert.match(page, /company\?\.role === "dispatcher" && integration\.connected && integration\.vehicles\.length > 0 && <div className="form-row"><label><span className="field-label">\{locale === "fr" \? "Camion"/);
});
