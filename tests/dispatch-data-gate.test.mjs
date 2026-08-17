import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("authenticated dashboard is gated until real API data resolves", () => {
  assert.match(source, /dispatchDataState === "loading"/);
  assert.match(source, /setDispatchDataState\("ready"\)/);
});

test("delivery API failure clears displayed rows instead of leaving stale tenant data", () => {
  const errorStart = source.indexOf("if (active && !tracking) {");
  const errorEnd = source.indexOf('setToast(translations[locale].cloudReconnecting)', errorStart);
  const errorCleanup = source.slice(errorStart, errorEnd);
  for (const statement of [
    "setDeliveries([])",
    "setStopPlans([])",
    "setTrips([])",
    "setRouteHistory([])",
    'setDispatchDataState("error")',
  ]) assert.ok(errorCleanup.includes(statement), statement);
});


test("WhatsApp demo history starts empty instead of showing a fake sent message", () => {
  assert.equal(source.includes('id: "demo-tracking"'), false);
  assert.match(source, /useState<MessageEvent\[\]>\(\[\]\)/);
});
