import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { evaluateArrivalDwell, parseUnloadGraceMinutes } from "../app/lib/delivery-arrival.ts";

const [routeProgress, serverAutomation, vercelCompletion, cloudflareCompletion, manualRoute, siteManager] = await Promise.all([
  readFile(new URL("../app/lib/route-progress.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-completion.vercel.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-completion.cloudflare.ts", import.meta.url), "utf8"),
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
  assert.match(routeProgress, /Keep active deliveries at\n  \/\/ 99% until one of those completion paths confirms delivery/);
  assert.match(routeProgress, /Math\.min\(99, Math\.max\(previousProgress, metrics\.progress\)\)/);
  assert.doesNotMatch(routeProgress, /distanceToDestinationKm <= safeArrivalRadiusKm && speed <= 5/);
});

test("automation applies arrival dwell before reloading deliveries", () => {
  assert.match(serverAutomation, /observeArrivalCompletion/);
  assert.match(serverAutomation, /TRACKFLEET_UNLOAD_GRACE_MINUTES/);
  assert.match(serverAutomation, /ARRIVED_AT_SITE/);
  assert.match(serverAutomation, /const deliveries = await store\.listForCompany\(companyId\)/);
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

test("manual completion is authenticated, same-origin and tenant scoped", () => {
  assert.match(manualRoute, /requestIsSameOrigin\(request\)/);
  assert.match(manualRoute, /getCompanySession\(request\)/);
  assert.match(manualRoute, /completeDeliveryManually\(session\.companyId, deliveryId\)/);
  assert.match(manualRoute, /deliveryId\.length > 100/);
  assert.match(manualRoute, /confirmDelivered !== true/);
  assert.match(manualRoute, /readJsonObject\(request\)/);
});

test("manual completion UI requires explicit operator confirmation", () => {
  assert.match(siteManager, /window\.confirm\(confirmation\)/);
  assert.match(siteManager, /\/api\/deliveries\/manual-completion/);
  assert.match(siteManager, /confirmDelivered: true/);
  assert.match(siteManager, /Marquer livré/);
});
