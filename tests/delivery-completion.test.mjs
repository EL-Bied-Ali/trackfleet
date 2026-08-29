import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import "./unloading-delay-suppression.test.mjs";
import "./unload-departure-guard.test.mjs";
import { evaluateArrivalDwell, parseUnloadGraceMinutes } from "../app/lib/delivery-arrival.ts";

const [routeProgress, serverAutomation, businessTick, vercelCompletion, cloudflareCompletion, sharedPostgresCompletion, manualRoute, siteManager] = await Promise.all([
  readFile(new URL("../app/lib/route-progress.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-completion.vercel.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-completion.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-completion.shared-postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8"),
]);

test("unload grace defaults to two hours and stays within safe bounds", () => {
  assert.equal(parseUnloadGraceMinutes(undefined), 120);
  assert.equal(parseUnloadGraceMinutes(""), 120);
  assert.equal(parseUnloadGraceMinutes("60"), 60);
  assert.equal(parseUnloadGraceMinutes("1"), 15);
  assert.equal(parseUnloadGraceMinutes("9999"), 720);
  assert.equal(parseUnloadGraceMinutes("broken"), 120);
});

test("continuous arrival dwell requires the full configured unloading time", () => {
  const started = new Date("2026-08-19T08:00:00.000Z");
  const base = {
    status: "In transit",
    distanceToDestinationKm: 0.2,
    speed: 0,
    positionAgeMinutes: 1,
    arrivalRadiusKm: 0.5,
    unloadGraceMinutes: 120,
  };
  const entered = evaluateArrivalDwell({ ...base, arrivalSiteSince: null, observationAt: started });
  assert.equal(entered.justEntered, true);
  assert.equal(entered.delivered, false);

  const before = evaluateArrivalDwell({ ...base, arrivalSiteSince: started, observationAt: new Date(started.getTime() + 119 * 60_000) });
  assert.equal(before.delivered, false);

  const complete = evaluateArrivalDwell({ ...base, arrivalSiteSince: started, observationAt: new Date(started.getTime() + 120 * 60_000) });
  assert.equal(complete.delivered, true);
});

test("leaving the geofence or using stale GPS cancels the dwell", () => {
  const started = new Date("2026-08-19T08:00:00.000Z");
  const outside = evaluateArrivalDwell({
    status: "In transit", distanceToDestinationKm: 0.8, speed: 0, positionAgeMinutes: 1,
    arrivalRadiusKm: 0.5, arrivalSiteSince: started, observationAt: new Date("2026-08-19T09:00:00.000Z"), unloadGraceMinutes: 120,
  });
  assert.equal(outside.arrivalSiteSince, null);
  assert.equal(outside.delivered, false);

  const stale = evaluateArrivalDwell({
    status: "In transit", distanceToDestinationKm: 0.2, speed: 0, positionAgeMinutes: 31,
    arrivalRadiusKm: 0.5, arrivalSiteSince: started, observationAt: new Date("2026-08-19T09:00:00.000Z"), unloadGraceMinutes: 120,
  });
  assert.equal(stale.arrivalSiteSince, null);
  assert.equal(stale.delivered, false);
});

test("GPS alone can no longer finalize an active delivery", () => {
  assert.match(routeProgress, /Keep active deliveries at\r?\n\s{2}\/\/ 99% until one of those completion paths confirms delivery/);
  assert.match(routeProgress, /Math\.min\(99, Math\.max\(previousProgress, metrics\.progress\)\)/);
  assert.doesNotMatch(routeProgress, /distanceToDestinationKm <= safeArrivalRadiusKm && speed <= 5/);
});

test("automation applies arrival dwell before reloading deliveries", () => {
  assert.match(serverAutomation, /runFleetBusinessTick/);
  assert.match(serverAutomation, /TRACKFLEET_UNLOAD_GRACE_MINUTES/);
  assert.match(businessTick, /observeArrivalCompletion/);
  assert.match(businessTick, /ARRIVED_AT_SITE/);
  assert.match(businessTick, /const deliveries = await store\.listForCompany\(companyId\)/);
});

test("both persistent runtimes reset continuity after a GPS observation gap", () => {
  for (const source of [vercelCompletion, cloudflareCompletion]) {
    assert.match(source, /30 \* 60_000/);
    assert.match(source, /last_observed_at/);
    assert.match(source, /delivery_arrival_state/);
    assert.match(source, /company_id/);
    assert.match(source, /status.*Delivered/);
    assert.match(source, /MANUAL_DELIVERED/);
    assert.match(source, /ARRIVED/);
  }
});

test("manual arrival and completion are authenticated, same-origin and tenant scoped", () => {
  assert.match(manualRoute, /requestIsSameOrigin\(request\)/);
  assert.match(manualRoute, /getCompanySession\(request\)/);
  assert.match(manualRoute, /completeDeliveryManually\(session\.companyId, deliveryId\)/);
  assert.match(manualRoute, /deliveryId\.length > 100/);
  assert.match(manualRoute, /confirmArrival !== true && payload\.confirmDelivered !== true/);
  assert.match(manualRoute, /find\(\(candidate\) => candidate\.id === deliveryId/);
  assert.match(manualRoute, /observeArrivalCompletion/);
  assert.match(manualRoute, /MANUAL_ARRIVAL_CONFIRMED/);
  assert.match(manualRoute, /recordEvent\(deliveryId, "ARRIVED_AT_SITE"/);
  assert.match(manualRoute, /processPendingNotifications/);
  assert.match(manualRoute, /readJsonObject\(request\)/);
});

test("manual completion UI requires explicit operator confirmation", () => {
  assert.match(siteManager, /window\.confirm\(confirmation\)/);
  assert.match(siteManager, /\/api\/deliveries\/manual-completion/);
  assert.match(siteManager, /confirmDelivered: true/);
  assert.match(siteManager, /window\.location\.reload\(\)/);
  assert.match(siteManager, /Marquer livré/);
  assert.match(siteManager, /confirmArrival: true/);
  assert.match(siteManager, /Confirmer l’arrivée/);
  assert.match(siteManager, /Confirmation recommandée/);
});

// A delivery with no SENDATRACK-tracked vehicle never gets the automatic
// Loading -> In transit transition (nothing GPS-observes it leaving), so
// without a manual override it sits in Loading forever -- the same gap
// completeDeliveryManually already covers for the Delivered end of the
// trip. Mirrors that function's shape and the route's confirmArrival
// branch, just for the opposite direction.
test("manual departure confirmation only applies to a delivery still in Loading, gated dispatcher-only same as marking delivered", () => {
  assert.match(manualRoute, /confirmDepartureManually/);
  assert.match(manualRoute, /payload\.confirmDeparture !== true/);
  assert.match(manualRoute, /session\.role === "agency" && \(payload\.confirmDelivered === true \|\| payload\.confirmDeparture === true\)/);
  assert.match(manualRoute, /if \(!departed\) return noStore\(\{ error: "delivery_not_found_or_not_loading" \}, 404\);/);
  for (const source of [vercelCompletion, cloudflareCompletion]) {
    assert.match(source, /status = 'Loading'/);
    assert.match(source, /status = 'In transit'/);
    assert.match(source, /MANUAL_DEPARTURE_CONFIRMED/);
    assert.match(source, /'DEPARTED'/);
  }
});

test("the D1 mirror replicates a confirmed manual departure the same way it already mirrors manual completion", () => {
  assert.match(sharedPostgresCompletion, /confirmDepartureManually as confirmPrimaryDeparture/);
  assert.match(sharedPostgresCompletion, /async function mirrorManualDeparture/);
  assert.match(sharedPostgresCompletion, /UPDATE deliveries SET status = 'In transit' WHERE id = \? AND company_id = \?/);
  assert.match(sharedPostgresCompletion, /MANUAL_DEPARTURE_CONFIRMED/);
  assert.match(sharedPostgresCompletion, /export async function confirmDepartureManually\(companyId: string, deliveryId: string\) \{/);
});

test("unlike confirming arrival (a real, customer-facing GPS milestone the automatic push set includes), confirming departure never calls processPendingNotifications -- DEPARTED is deliberately excluded from that set", () => {
  const departureBranch = manualRoute.slice(manualRoute.indexOf("if (payload.confirmDeparture === true) {"), manualRoute.indexOf("if (payload.confirmArrival === true) {"));
  assert.doesNotMatch(departureBranch, /await processPendingNotifications/);
});

test("the site manager's dedicated ops panel offers a departure-confirm action instead of a premature arrival-confirm one, for a delivery still in Loading", () => {
  assert.match(siteManager, /function departurePending\(delivery: ManualDelivery\) \{\s*\n\s*return delivery\.status === "Loading";/);
  assert.match(siteManager, /confirmDeparture: true/);
  assert.match(siteManager, /!unassigned && departurePending\(delivery\)/);
  assert.match(siteManager, /!unassigned && !departurePending\(delivery\) && !arrivalConfirmed/);
  assert.match(siteManager, /departurePending\(delivery\)\s*\n\s*\? copy\.departurePending/);
});

// Reported live during an audit: this panel and the delivery table's
// group-level departure/arrival buttons (confirmGroupDeparture/
// confirmGroupArrival in page.tsx) both call the exact same manual-
// completion action, but only the table's version actually told the
// customer -- this panel changed the delivery's status and stopped there.
// Since dispatchers use whichever surface is in front of them for the same
// real-world action, silently skipping the WhatsApp notice here was a
// customer-facing gap, not just a UI inconsistency. Now attempts the same
// free, best-effort notify-departure/notify-arrival call the table already
// uses, and reports honestly whether it actually went out (a closed 24h
// window or withdrawn consent is a normal, expected outcome, not a failure
// to hide).
test("the site manager's ops panel now notifies the customer via WhatsApp after confirming arrival or departure, same as the delivery table's group buttons", () => {
  assert.match(siteManager, /const \[completionNotice, setCompletionNotice\] = useState\(""\);/);
  assert.match(siteManager, /fetch\("\/api\/deliveries\/notify-arrival", \{/);
  assert.match(siteManager, /fetch\("\/api\/deliveries\/notify-departure", \{/);
  assert.match(siteManager, /setCompletionNotice\(notifyResponse\.ok \? copy\.arrivalNotified : copy\.arrivalNotNotified\);/);
  assert.match(siteManager, /setCompletionNotice\(notifyResponse\.ok \? copy\.departureNotified : copy\.departureNotNotified\);/);
  assert.match(siteManager, /\{completionNotice && <p className="agency-location-message" role="status">\{completionNotice\}<\/p>\}/);
});
