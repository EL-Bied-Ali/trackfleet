import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("the create-delivery form warns when the selected truck already has another undelivered delivery in progress", () => {
  // The "next truck departure" date was a plain manually-typed field with no
  // check against reality (reported live) -- a dispatcher could schedule a
  // truck's next departure while that same truck is still out on its current
  // delivery. This doesn't block submission (the dispatcher may already know
  // the truck is back even if the record isn't marked Delivered yet), it
  // just surfaces what the data already shows.
  assert.match(page, /const creationVehicleConflict = creationVehicleId !== UNASSIGNED_VEHICLE_ID\s*\n\s*\? deliveries\.find\(\(delivery\) => delivery\.sendatrackVehicleId === creationVehicleId && delivery\.status !== "Delivered"\)\s*\n\s*: undefined;/);
  assert.match(page, /\{creationVehicleConflict && <small className="warning">/);
});

test("the conflict warning names the conflicting delivery and its expected arrival", () => {
  assert.match(page, /Ce camion est encore en route \(\$\{creationVehicleConflict\.id\}, arrivée prévue/);
  assert.match(page, /This truck is still en route \(\$\{creationVehicleConflict\.id\}, expected/);
  assert.match(page, /creationVehicleConflict\.estimatedArrivalAt \? new Date\(creationVehicleConflict\.estimatedArrivalAt\)\.toLocaleString\("fr-BE"/);
});

test("selecting a vehicle updates the conflict check live, and the choice resets whenever the creation modal closes or a submission succeeds", () => {
  const setterCalls = page.match(/setCreationVehicleId\(/g) ?? [];
  // onChange (drives the live check) + both close paths (× button, Cancel
  // button) + the reset-all-`setModalOpen(false)`-sites via replace_all +
  // the post-submit success reset = at least 4 call sites.
  assert.ok(setterCalls.length >= 4, `expected at least 4 setCreationVehicleId call sites, found ${setterCalls.length}`);
  assert.match(page, /onChange=\{\(event\) => setCreationVehicleId\(event\.target\.value\)\}/);
});

test("the warning text has its own styling distinct from the ordinary muted help text", () => {
  assert.match(css, /\.modal label small\.warning \{/);
});
