import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User pushed back on "it's just the free plan's limit" with a fair
// question: are we sure this isn't still our own code? Re-auditing found
// one more real one -- GET /api/deliveries called store.assignDeliveryTrip
// once per delivery in every active stop plan, on every single dashboard
// load, even for deliveries whose trip_id already matched (a pure-waste
// subrequest the store method's own WHERE clause was already turning into
// a no-op -- just not for free).
const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("assignDeliveryTrip is only called for deliveries not already assigned to this trip, using data already fetched this request", () => {
  assert.match(route, /const unassignedDeliveryIds = deliveryIds\.filter\(\(deliveryId\) => rowById\.get\(deliveryId\)\?\.tripId !== persistedTrip\.id\);/);
  assert.match(route, /await Promise\.all\(unassignedDeliveryIds\.map\(\(deliveryId\) => store\.assignDeliveryTrip\(deliveryId, session\.companyId, persistedTrip\.id\)\)\);/);
  assert.doesNotMatch(route, /await Promise\.all\(deliveryIds\.map\(\(deliveryId\) => store\.assignDeliveryTrip/);
});
