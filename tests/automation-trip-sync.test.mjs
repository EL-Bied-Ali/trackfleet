import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8");

test("autonomous tick persists, assigns and completes trips", () => {
  assert.match(source, /store\.upsertTrip/);
  assert.match(source, /store\.assignDeliveryTrip/);
  assert.match(source, /store\.listDeliveryIdsForTrip/);
  assert.match(source, /tripStatusFromDeliveryStatuses/);
  assert.match(source, /status: "completed"/);
});
