import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../app/api/deliveries/assign-trip/route.ts", import.meta.url), "utf8");
const pg = fs.readFileSync(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8");
const d1 = fs.readFileSync(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8");
const memory = fs.readFileSync(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8");

test("planned trip assignment is tenant checked and conflict safe", () => {
  assert.match(api, /getDispatcherSession/);
  assert.match(api, /store\.getTrip\(session\.companyId, tripId\)/);
  assert.match(api, /validatePlannedTripAssignment/);
  assert.match(pg, /trip_id IS NULL/);
  assert.match(pg, /truck = \$\{UNASSIGNED_TRUCK\}/);
  assert.match(d1, /trip_id IS NULL AND truck = \?/);
});

test("a known provider id still gets a GPS baseline on first real snapshot", () => {
  assert.match(pg, /const firstLink = delivery\.gpsSource !== "sendatrack"/);
  assert.match(d1, /const firstLink = delivery\.gpsSource !== "sendatrack"/);
  assert.match(memory, /const firstLink = delivery\.gpsSource !== "sendatrack"/);
});
