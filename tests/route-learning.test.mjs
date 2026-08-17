import assert from "node:assert/strict";
import test from "node:test";
import { routeLearningState, stablePlanRouteTemplateId } from "../app/lib/route-learning.ts";

test("route learning remains collecting before any historical evidence", () => {
  assert.deepEqual(routeLearningState({ historicalTrips: 0, learnedStops: 0, futureStops: 2 }), {
    historicalTrips: 0,
    requiredTrips: 5,
    learnedStops: 0,
    futureStops: 2,
    etaHistoryReady: false,
    dwellHistoryReady: false,
    stage: "collecting",
  });
});

test("route learning is ready only when pace and future stop dwell are learned", () => {
  const state = routeLearningState({ historicalTrips: 7, learnedStops: 2, futureStops: 2 });
  assert.equal(state.etaHistoryReady, true);
  assert.equal(state.dwellHistoryReady, true);
  assert.equal(state.stage, "ready");
});

test("stable trip route id overrides the shortened active stop plan", () => {
  const contexts = new Map([
    ["D-2", { routeTemplateId: "ROUTE-FULL" }],
    ["D-3", { routeTemplateId: "ROUTE-FULL" }],
  ]);
  assert.equal(stablePlanRouteTemplateId("ROUTE-REMAINING", ["D-2", "D-3"], contexts), "ROUTE-FULL");
});

test("computed plan id is retained before a trip has a frozen context", () => {
  assert.equal(stablePlanRouteTemplateId("ROUTE-PLANNED", ["D-1"], new Map()), "ROUTE-PLANNED");
});
