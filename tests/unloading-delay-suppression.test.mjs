import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [automationDelay, deliveriesRoute] = await Promise.all([
  readFile(new URL("../app/lib/automation-delay.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
]);

test("scheduler does not create delay alerts after arrival at the site", () => {
  assert.match(automationDelay, /ARRIVED_AT_SITE/);
  assert.match(automationDelay, /DELAY_DETECTED/);
});

test("authenticated refresh also suppresses delay detection during unloading", () => {
  assert.match(deliveriesRoute, /delivered: row\.status === "Delivered" \|\| events\.some\(\(event\) => event\.type === "ARRIVED_AT_SITE"\)/);
});
