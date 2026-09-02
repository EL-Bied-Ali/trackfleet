import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Follow-up to the 2026-09-02 outage (see deliveries-route-subrequest-budget.test.mjs):
// found two more routes with the exact same shape -- one store.listEvents
// call per delivery in a company-wide loop -- before they hit real volume
// and 500ed the way GET /api/deliveries did.
const whatsappConsentRoute = await readFile(new URL("../app/api/deliveries/whatsapp-consent/route.ts", import.meta.url), "utf8");
const manualCompletionRoute = await readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8");

test("the WhatsApp consent list fetches every delivery's events in one company-scoped query, not one store.listEvents call per delivery", () => {
  assert.doesNotMatch(whatsappConsentRoute, /deliveries\.map\(async/);
  assert.match(whatsappConsentRoute, /store\.listEventsForDeliveries\(session\.companyId, deliveries\.map\(\(delivery\) => delivery\.id\)\)/);
});

test("the manual-completion recommendation list fetches every visible delivery's events in one company-scoped query, not one store.listEvents call per delivery", () => {
  assert.doesNotMatch(manualCompletionRoute, /visible\.map\(async/);
  assert.match(manualCompletionRoute, /store\.listEventsForDeliveries\(session\.companyId, visible\.map\(\(delivery\) => delivery\.id\)\)/);
});
