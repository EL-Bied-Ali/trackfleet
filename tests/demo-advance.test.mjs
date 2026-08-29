import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { progressRouteDestination } from "../app/lib/delivery-progress-destination.ts";
import { calculateRouteMetrics } from "../app/lib/route-progress.ts";

const route = await readFile(new URL("../app/api/deliveries/demo/advance/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the demo advance route is dispatcher-only and same-origin protected", () => {
  assert.match(route, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(route, /if \(session\.role !== "dispatcher"\) return noStore\(\{ error: "dispatcher_only" \}, 403\);/);
});

test("the demo advance route refuses anything that isn't a [DEMO]-marked delivery, even one that exists for this company", () => {
  assert.match(route, /if \(!delivery \|\| !delivery\.customer\.startsWith\(DEMO_DELIVERY_CUSTOMER_PREFIX\)\) \{/);
});

test("advancing a delivery that's already Delivered is refused rather than silently reviving it", () => {
  assert.match(route, /if \(delivery\.status === "Delivered"\) return noStore\(\{ error: "already_delivered" \}, 400\);/);
});

test("progress advances through fixed milestones and stops short of 100 -- arrival stays a separate, deliberate confirmation step", () => {
  assert.match(route, /const DEMO_PROGRESS_STAGES = \[35, 70, 95\];/);
  assert.match(route, /const nextProgress = DEMO_PROGRESS_STAGES\.find\(\(stage\) => stage > delivery\.progress\);/);
  assert.match(route, /if \(!nextProgress\) return noStore\(\{ ok: true, deliveryId, unchanged: true, delivery \}\);/);
});

test("the interpolated position follows the delivery's own real corridor route (via pointAtRouteFraction), not a straight line between origin and destination", () => {
  assert.match(route, /import \{ pointAtRouteFraction, routeForDestination \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/route-progress";/);
  assert.match(route, /const route = routeForDestination\(progressDestination\.destination, progressDestination\.explicitDestination, explicitOrigin\);/);
  assert.match(route, /const \[longitude, latitude\] = pointAtRouteFraction\(route, nextProgress \/ 100\);/);
});

// Reported live: verified against a real Tétouan demo delivery -- at 95%
// progress the interpolated position was still on the Spanish side of the
// strait, nowhere near Morocco, because the demo route was measured against
// the parcel's actual final site. A real GPS-linked delivery to the same
// agency has progressRouteDestination cap route math at the confirmed hub
// instead (see delivery-progress-destination.ts, applied on every real GPS
// link) so progress can actually reach 100% once the truck is GPS-tracked
// that far -- measured against the real final site, it never would (the
// relay leg past the hub has no GPS at all). The demo route now applies
// that exact same substitution so a relay-destination demo's progress
// behaves like what a customer would actually see on a real delivery.
test("the demo advance route caps route/progress math at the confirmed hub for a relay destination, same as a real GPS-linked delivery", () => {
  assert.match(route, /import \{ progressRouteDestination \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/delivery-progress-destination";/);
  assert.match(route, /const progressDestination = progressRouteDestination\(\{ destination: delivery\.destination, destinationSiteId: delivery\.destinationSiteId, explicitDestination \}\);/);

  // Behavioral proof, not just source matching: a truck sitting right at the
  // hub reads 100% when progress is measured against the hub (matching real
  // GPS-linked delivery behavior), but only 96% measured against the
  // parcel's actual final site -- confirming the fix's premise that the
  // uncapped math can never cleanly reach 100% for a relay destination.
  const hubLatitude = 35.89;
  const hubLongitude = -5.5;
  const uncapped = calculateRouteMetrics(hubLatitude, hubLongitude, "146 Avenue Cortoba, Tétouan, Maroc");
  assert.ok(uncapped.progress < 100, `expected progress measured against the real final site to fall short at the hub, was ${uncapped.progress}`);

  const capped = progressRouteDestination({ destination: "146 Avenue Cortoba, Tétouan, Maroc", destinationSiteId: "tetouan-cortoba-146", explicitDestination: null });
  const cappedMetrics = calculateRouteMetrics(hubLatitude, hubLongitude, capped.destination, capped.explicitDestination);
  assert.equal(cappedMetrics.progress, 100, "expected progress measured against the hub to reach 100% once the truck is actually there");
});

test("advancing always sets status to In transit -- forgiving of click order if the dispatcher advances before confirming departure", () => {
  assert.match(route, /status: "In transit",/);
});

// Reported live: the demo panel originally duplicated "Confirmer le
// départ"/"Confirmer l'arrivée" as its own buttons, calling the exact same
// confirmGroupDeparture/confirmGroupArrival actions the real table's group
// header row already offers for this same delivery (it's a real row, just
// marked [DEMO]). Removed as redundant -- the dispatcher uses the real
// table's buttons for those two steps, and the demo panel is now scoped to
// only the one thing nothing else provides: moving the delivery without a
// real truck.
test("the demo walkthrough panel only offers the advance action -- departure and arrival are confirmed from the delivery's own row in the real table, not duplicated here", () => {
  assert.match(page, /const \[demoActiveDeliveryId, setDemoActiveDeliveryId\] = useState<string \| null>\(null\);/);
  assert.match(page, /async function advanceDemoDelivery\(\) \{/);
  assert.match(page, /fetch\("\/api\/deliveries\/demo\/advance", \{/);
  assert.match(page, /className="demo-walkthrough"/);
  assert.doesNotMatch(page, /confirmGroupDeparture\("__demo__"/);
  assert.doesNotMatch(page, /confirmGroupArrival\("__demo__"/);
});

test("the demo creation route now returns the full delivery row, so the panel can show it immediately instead of waiting for the next 30s poll", async () => {
  const demoCreateRoute = await readFile(new URL("../app/api/deliveries/demo/route.ts", import.meta.url), "utf8");
  assert.match(demoCreateRoute, /return noStore\(\{ ok: true, deliveryId: delivery\.id, delivery \}\);/);
  assert.match(page, /setDemoActiveDeliveryId\(data\.deliveryId \?\? null\);/);
  assert.match(page, /if \(data\.delivery\) setDeliveries\(\(items\) => \[\.\.\.items, data\.delivery\]\);/);
});
