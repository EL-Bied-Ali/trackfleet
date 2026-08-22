import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("authenticated dashboard is gated until real API data resolves", () => {
  assert.match(source, /dispatchDataState === "loading"/);
  assert.match(source, /setDispatchDataState\("ready"\)/);
});

test("the initial (non-silent) delivery API failure clears displayed rows instead of leaving stale tenant data", () => {
  // This path only runs for a fresh session's first load: the polling
  // effect depends on [authState, company?.role, locale], so it tears down
  // and restarts on every session change -- a background poll can never
  // fire under a different company's stale closure.
  const errorStart = source.indexOf("if (active && !tracking) {");
  const errorEnd = source.indexOf('setToast(translations[locale].cloudReconnecting)', errorStart);
  const errorCleanup = source.slice(errorStart, errorEnd);
  for (const statement of [
    "if (!silent) {",
    "setDeliveries([])",
    "setStopPlans([])",
    "setTrips([])",
    "setRouteHistory([])",
    'setDispatchDataState("error")',
  ]) assert.ok(errorCleanup.includes(statement), statement);
});

test("a silent background poll failure shows a toast and keeps the dashboard visible, instead of blanking it", () => {
  // Regression guard, reproduced live: a single missed 30-second background
  // poll (refresh(true)) wiped the whole dispatcher view to the full-screen
  // "Data temporarily unavailable" error with no warning, even though the
  // backend was healthy again within seconds -- the initial-load error path
  // didn't distinguish "nothing has ever loaded" from "one poll blipped
  // while a working dashboard was already showing."
  const errorStart = source.indexOf("if (active && !tracking) {");
  const toastCall = "setToast(translations[locale].cloudReconnecting);";
  const toastIndex = source.indexOf(toastCall, errorStart);
  assert.ok(toastIndex > errorStart, "expected the cloudReconnecting toast inside the !tracking error block");
  const errorBlock = source.slice(errorStart, toastIndex + toastCall.length + 20);
  assert.match(errorBlock, /\} else \{\s*setToast\(translations\[locale\]\.cloudReconnecting\);\s*\}/);
  // The silent branch must not touch setDeliveries/setStopPlans/setTrips/
  // setRouteHistory/setDispatchDataState -- only the non-silent branch above
  // (already asserted in the previous test) may.
  const silentBranch = errorBlock.slice(errorBlock.indexOf("} else {"));
  for (const statement of ["setDeliveries([])", "setStopPlans([])", "setTrips([])", "setRouteHistory([])", 'setDispatchDataState("error")']) {
    assert.equal(silentBranch.includes(statement), false, `silent branch must not include ${statement}`);
  }
});


test("WhatsApp demo history starts empty instead of showing a fake sent message", () => {
  assert.equal(source.includes('id: "demo-tracking"'), false);
  assert.match(source, /useState<MessageEvent\[\]>\(\[\]\)/);
});
