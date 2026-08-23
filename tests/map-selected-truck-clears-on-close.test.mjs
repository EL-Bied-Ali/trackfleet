import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("the orange selected-truck highlight on the dispatcher map clears once the popover is closed, instead of sticking to the last-clicked truck forever", () => {
  // Reported live: a clicked truck's marker turned orange and stayed that
  // way "whatever happens" -- closing the popover (the X button or clicking
  // empty map area) only hid the popover, it never reset selectedId /
  // selectedVehicleId, and .maplibre-truck.selected is styled purely off
  // those two props. The underlying state is left alone (still needed to
  // remember which delivery/vehicle the popover should reopen to show) --
  // only what's passed to InteractiveFleetMap for the visual highlight is
  // gated behind showPopover, so the highlight now tracks "is a truck
  // actually being viewed right now", not "was one ever clicked".
  assert.match(page, /<InteractiveFleetMap deliveries=\{mapDeliveriesWithOrigin\} liveVehicles=\{liveVehiclesWithNumbers\} selectedId=\{showPopover \? selectedId : ""\} selectedVehicleId=\{showPopover \? selectedVehicleId : null\}/);
});
